import { extend, isArray, isIntegerKey, isMap, isSymbol } from '@vue/shared'
import type { ComputedRefImpl } from './computed'
import { type TrackOpTypes, TriggerOpTypes } from './constants'
import {
  type DebuggerEventExtraInfo,
  EffectFlags,
  type Subscriber,
  activeSub,
  endBatch,
  shouldTrack,
  startBatch,
} from './effect'

/**
 * 每次响应式变化都会递增
 * 这是给 computed 提供快速路径，以便在没有变化时避免重新计算。
 */
export let globalVersion = 0

/**
 * 表示 source（Dep）与订阅者（Effect 或 Computed）之间的连接。
 * Dep 与 sub 是多对多关系 - 每一条 dep 与 sub 之间的连接
 * 由一个 Link 实例表示。
 *
 * Link 同时是两个双向链表中的节点 - 一个用于关联的 sub
 * 跟踪它的所有 deps，另一个用于关联的 dep 跟踪它的所有
 *
 * @internal
 */
export class Link {
  /**
   * - 每次 effect 运行前，所有旧的 dep link 的 version 会重置为 -1
   * - 在追踪依赖期间，会同步 Dep 的 version
   * - 当依赖追踪结束后，如果 version 还是 -1，则直接清除（说明当前副作用没用到）
   */
  version: number

  /**
   * 双向链表指针
   */
  nextDep?: Link
  prevDep?: Link
  nextSub?: Link
  prevSub?: Link
  prevActiveLink?: Link

  constructor(
    public sub: Subscriber,
    public dep: Dep,
  ) {
    this.version = dep.version
    this.nextDep =
      this.prevDep =
      this.nextSub =
      this.prevSub =
      this.prevActiveLink =
        undefined
  }
}

/**
 * @internal
 */
export class Dep {
  version = 0 // 记录当前数据修改的版本（修改了数据就会累加）
  /**
   * 1.复用旧 Link
   * effect/computed 重新执行前，prepareDeps() 会把旧依赖的 link.version 先设成 -1，并把 dep.activeLink 指回这条旧 link。
   * 访问还是同一个 dep 时，在 track() 时就能复用旧 link。
   *
   * 2.动态切换上下文
   * 如果外层 effect/computed 和内层 effect/computed 都访问同一个 dep，dep.activeLink 会暂时被内层覆盖。
   * 所以 prepareDeps() 会把旧值存到 link.prevActiveLink，等本轮结束后在 cleanupDeps() 里恢复，避免串乱。
   *
   * 简单来说，activeLink 是当前执行中的临时定位指针，就记录着当前运行时，当前的 dep 对应着哪个订阅者
   *
   */
  activeLink?: Link = undefined

  /**
   * 订阅者的双向链表（尾部）
   */
  subs?: Link = undefined

  /**
   * 订阅者的双向链表（头部）
   * 仅 DEV：用于按正确顺序调用 onTrigger hook
   */
  subsHead?: Link

  /**
   * 用于对象属性 deps 的清理
   */
  map?: KeyToDepMap = undefined // “键对依赖映射”对象
  key?: unknown = undefined // 依赖的键

  sc: number = 0 // 订阅者数量

  /**
   * @internal
   */
  readonly __v_skip = true
  // TODO isolatedDeclarations ReactiveFlags.SKIP（待处理）

  // 传入计算属性后，表示当前依赖为一个计算属性
  constructor(public computed?: ComputedRefImpl | undefined) {
    if (__DEV__) {
      this.subsHead = undefined
    }
  }

  // 依赖追踪，查看哪些副作用函数用到了“自己”，记录起来
  track(debugInfo?: DebuggerEventExtraInfo): Link | undefined {
    // 这里之所以还要对计算属性进行判断，是为了避免当前正在求值的 computed 把自己收集到自己的 dep 上
    if (!activeSub || !shouldTrack || activeSub === this.computed) {
      return
    }

    let link = this.activeLink
    // 第一次副作用运行，并且该依赖的订阅者是当前正在运行的订阅者
    if (link === undefined || link.sub !== activeSub) {
      link = this.activeLink = new Link(activeSub, this) // 创建连接

      // 当前活跃的副作用如果不存在依赖，说明这个副作用是第一次执行
      if (!activeSub.deps) {
        activeSub.deps = activeSub.depsTail = link // 订阅者对应的依赖头和尾都进行赋值
      } else {
        link.prevDep = activeSub.depsTail
        activeSub.depsTail!.nextDep = link
        // 上面两个实际的作用其实就是建立依赖之间的连接，让最新的依赖能够在上一个最后一个依赖之后，像一条链一样串着
        activeSub.depsTail = link // 更新订阅者尾部连接
      }

      addSub(link)
    }
    // 被标记为“软删除”，但副作用又重新运行了，并且用到了该依赖
    else if (link.version === -1) {
      link.version = this.version // 替换为当前依赖的版本
      // 判断是否为尾节点，如果存在下一个节点才需要移动
      if (link.nextDep) {
        // 下面做的都是将新依赖进行尾部追加
        // 保证了链表前段都是"本次没访问的旧依赖"，后段都是"本次访问过的依赖"
        const next = link.nextDep
        next.prevDep = link.prevDep
        if (link.prevDep) {
          link.prevDep.nextDep = next
        }

        link.prevDep = activeSub.depsTail
        link.nextDep = undefined
        activeSub.depsTail!.nextDep = link
        activeSub.depsTail = link

        if (activeSub.deps === link) {
          activeSub.deps = next
        }
      }
    }

    if (__DEV__ && activeSub.onTrack) {
      activeSub.onTrack(
        extend(
          {
            effect: activeSub,
          },
          debugInfo,
        ),
      )
    }

    return link
  }

  trigger(debugInfo?: DebuggerEventExtraInfo): void {
    this.version++
    globalVersion++
    this.notify(debugInfo)
  }

  notify(debugInfo?: DebuggerEventExtraInfo): void {
    startBatch()
    try {
      if (__DEV__) {
        // subs 会以逆序通知并批处理，随后在批处理结束时按原顺序调用，
        // 但 onTrigger hook 应在这里按原顺序调用。
        for (let head = this.subsHead; head; head = head.nextSub) {
          if (head.sub.onTrigger && !(head.sub.flags & EffectFlags.NOTIFIED)) {
            head.sub.onTrigger(
              extend(
                {
                  effect: head.sub,
                },
                debugInfo,
              ),
            )
          }
        }
      }
      for (let link = this.subs; link; link = link.prevSub) {
        if (link.sub.notify()) {
          // 通知订阅者，如果 notify() 返回 `true`，说明这是 computed
          // 还需要调用它的 dep.notify - 放在这里而不是 computed 的 notify
          // 内部，以降低调用栈深度。
          ;(link.sub as ComputedRefImpl).dep.notify()
        }
      }
    } finally {
      endBatch()
    }
  }
}

// 完善 link 的 dep -> sub 这条链路的指向
// 在 track 的时候，只记录了 sub -> dep，即订阅者对应的所有依赖有哪些，而这里需要建立反向链
// 同时需要记录 dep 对应的 sub 有哪些
function addSub(link: Link) {
  link.dep.sc++ // 依赖被订阅者订阅的数量累加
  // 只有当订阅者（sub）正处于追踪状态时，才需要真正建立订阅关系
  if (link.sub.flags & EffectFlags.TRACKING) {
    const computed = link.dep.computed

    // 如果依赖为计算属性并且没有订阅者（避免重复订阅，所以需要判断）
    if (computed && !link.dep.subs) {
      // 追踪自己的依赖，并且设置为脏
      computed.flags |= EffectFlags.TRACKING | EffectFlags.DIRTY
      for (let l = computed.deps; l; l = l.nextDep) {
        addSub(l) // 计算属性也能作为订阅者，所以需要递归处理其中的依赖
      }
    }

    const currentTail = link.dep.subs // 获取依赖对应的订阅者链表
    // 如果这个 link 已经是当前尾节点了，就不需要再操作一遍
    if (currentTail !== link) {
      // 订阅者尾部插入
      link.prevSub = currentTail
      if (currentTail) currentTail.nextSub = link // 如果是第一次可，当前的尾会为空，所以这里要判断
    }

    if (__DEV__ && link.dep.subsHead === undefined) {
      link.dep.subsHead = link
    }

    link.dep.subs = link // 更新尾部
  }
}

// 存储 {target -> key -> depMap} 关系的主 WeakMap。
// 从概念上看，可以把依赖理解为维护一组订阅者的 Dep 类，
// 但为了降低内存开销，我们用原始 Map 来存储。
type KeyToDepMap = Map<any, Dep>

export const targetMap: WeakMap<object, KeyToDepMap> = new WeakMap()

// 用于依赖追踪的特殊键
export const ITERATE_KEY: unique symbol = Symbol(
  __DEV__ ? 'Object iterate' : '',
)
export const MAP_KEY_ITERATE_KEY: unique symbol = Symbol(
  __DEV__ ? 'Map keys iterate' : '',
)
export const ARRAY_ITERATE_KEY: unique symbol = Symbol(
  __DEV__ ? 'Array iterate' : '',
)

// 依赖追踪，target 为原始对象，type 为触发追踪的类型，key 追踪类型的键
export function track(target: object, type: TrackOpTypes, key: unknown): void {
  // 可追踪，并且当前有活跃的订阅者（需要响应式，因为不需要响应式的话追踪毫无意义，浪费性能）
  // 所以这里需要判断是否有 activeSub
  if (shouldTrack && activeSub) {
    // 从 weakMap 中获取依赖的映射
    let depsMap = targetMap.get(target)
    // 如果没有则进行初始化
    if (!depsMap) {
      targetMap.set(target, (depsMap = new Map()))
    }
    let dep = depsMap.get(key) // 从依赖映射中获取对应键的依赖
    if (!dep) {
      // 初始化依赖并添加
      depsMap.set(key, (dep = new Dep()))
      dep.map = depsMap
      dep.key = key
    }
    if (__DEV__) {
      dep.track({
        target,
        type,
        key,
      })
    } else {
      dep.track()
    }
  }
}

/**
 *
 * @param target 目标对象
 * @param type 触发的类型（枚举）
 * @param key 修改的 key
 * @param newValue 所赋予的值
 * @param oldValue 某一个 key 之前的值
 * @param oldTarget 整个 Map / Set 在变更前的内容副本
 * @returns
 */
export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>,
): void {
  const depsMap = targetMap.get(target)
  // 不存在依赖对应的副作用
  if (!depsMap) {
    globalVersion++
    return
  }

  const run = (dep: Dep | undefined) => {
    if (dep) {
      if (__DEV__) {
        dep.trigger({
          target,
          type,
          key,
          newValue,
          oldValue,
          oldTarget,
        })
      } else {
        dep.trigger()
      }
    }
  }

  startBatch()

  if (type === TriggerOpTypes.CLEAR) {
    // 集合被清空
    // 触发目标上的所有 effect
    depsMap.forEach(run)
  } else {
    const targetIsArray = isArray(target)
    const isArrayIndex = targetIsArray && isIntegerKey(key)

    // 触发数组长度变化
    if (targetIsArray && key === 'length') {
      const newLength = Number(newValue)
      depsMap.forEach((dep, key) => {
        // 如果新长度比旧长度短，那么所有索引大于等于新长度的元素对应的依赖也要触发（因为它们被删除了）
        if (
          key === 'length' ||
          key === ARRAY_ITERATE_KEY ||
          (!isSymbol(key) && key >= newLength)
        ) {
          run(dep)
        }
      })
    } else {
      // 为 SET | ADD | DELETE 安排运行
      if (key !== void 0 || depsMap.has(void 0)) {
        run(depsMap.get(key))
      }

      // 为任何数值 key 变化安排 ARRAY_ITERATE（length 上面已处理）
      if (isArrayIndex) {
        run(depsMap.get(ARRAY_ITERATE_KEY))
      }

      // 在 ADD | DELETE | Map.SET 时也运行迭代 key
      switch (type) {
        case TriggerOpTypes.ADD:
          if (!targetIsArray) {
            run(depsMap.get(ITERATE_KEY))
            if (isMap(target)) {
              run(depsMap.get(MAP_KEY_ITERATE_KEY))
            }
          } else if (isArrayIndex) {
            // 数组新增索引 -> length 变化
            run(depsMap.get('length'))
          }
          break
        case TriggerOpTypes.DELETE:
          if (!targetIsArray) {
            run(depsMap.get(ITERATE_KEY))
            if (isMap(target)) {
              run(depsMap.get(MAP_KEY_ITERATE_KEY))
            }
          }
          break
        case TriggerOpTypes.SET:
          if (isMap(target)) {
            run(depsMap.get(ITERATE_KEY))
          }
          break
      }
    }
  }

  endBatch()
}

export function getDepFromReactive(
  object: any,
  key: string | number | symbol,
): Dep | undefined {
  const depMap = targetMap.get(object)
  return depMap && depMap.get(key)
}
