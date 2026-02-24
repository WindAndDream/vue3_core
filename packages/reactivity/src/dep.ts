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
 * 跟踪它的所有 deps，另一个用于关联的 dep 跟踪它的所有 subs。
 *
 * @internal
 */
export class Link {
  /**
   * - 每次 effect 运行前，所有旧的 dep link 的 version 会重置为 -1
   * - 运行期间，访问时会将 link 的 version 与 source dep 同步
   * - 运行结束后，version 为 -1（从未使用）的 link 会被清理
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
  version = 0
  /**
   * 此 dep 与当前 active effect 的连接
   */
  activeLink?: Link = undefined

  /**
   * 表示订阅 effect 的双向链表（尾部）
   */
  subs?: Link = undefined

  /**
   * 表示订阅 effect 的双向链表（头部）
   * 仅 DEV：用于按正确顺序调用 onTrigger hook
   */
  subsHead?: Link

  /**
   * 用于对象属性 deps 的清理
   */
  map?: KeyToDepMap = undefined
  key?: unknown = undefined

  /**
   * 订阅者计数
   */
  sc: number = 0

  /**
   * @internal
   */
  readonly __v_skip = true
  // TODO isolatedDeclarations ReactiveFlags.SKIP（待处理）

  constructor(public computed?: ComputedRefImpl | undefined) {
    if (__DEV__) {
      this.subsHead = undefined
    }
  }

  track(debugInfo?: DebuggerEventExtraInfo): Link | undefined {
    if (!activeSub || !shouldTrack || activeSub === this.computed) {
      return
    }

    let link = this.activeLink
    if (link === undefined || link.sub !== activeSub) {
      link = this.activeLink = new Link(activeSub, this)

      // 将 link 作为 dep（尾部）添加到 activeEffect
      if (!activeSub.deps) {
        activeSub.deps = activeSub.depsTail = link
      } else {
        link.prevDep = activeSub.depsTail
        activeSub.depsTail!.nextDep = link
        activeSub.depsTail = link
      }

      addSub(link)
    } else if (link.version === -1) {
      // 从上次运行复用 - 已是订阅者，仅同步 version
      link.version = this.version

      // 如果此 dep 有 next，说明它不在尾部 - 移动到尾部。
      // 这确保 effect 的 dep 列表顺序与求值时的访问顺序一致。
      if (link.nextDep) {
        const next = link.nextDep
        next.prevDep = link.prevDep
        if (link.prevDep) {
          link.prevDep.nextDep = next
        }

        link.prevDep = activeSub.depsTail
        link.nextDep = undefined
        activeSub.depsTail!.nextDep = link
        activeSub.depsTail = link

        // 之前是头结点 - 指向新的头结点
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
          // 如果 notify() 返回 `true`，说明这是 computed。
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

function addSub(link: Link) {
  link.dep.sc++
  if (link.sub.flags & EffectFlags.TRACKING) {
    const computed = link.dep.computed
    // computed 获取第一个订阅者
    // 启用跟踪 + 懒订阅其所有 deps
    if (computed && !link.dep.subs) {
      computed.flags |= EffectFlags.TRACKING | EffectFlags.DIRTY
      for (let l = computed.deps; l; l = l.nextDep) {
        addSub(l)
      }
    }

    const currentTail = link.dep.subs
    if (currentTail !== link) {
      link.prevSub = currentTail
      if (currentTail) currentTail.nextSub = link
    }

    if (__DEV__ && link.dep.subsHead === undefined) {
      link.dep.subsHead = link
    }

    link.dep.subs = link
  }
}

// 存储 {target -> key -> dep} 关系的主 WeakMap。
// 从概念上看，可以把依赖理解为维护一组订阅者的 Dep 类，
// 但为了降低内存开销，我们用原始 Map 来存储。
type KeyToDepMap = Map<any, Dep>

export const targetMap: WeakMap<object, KeyToDepMap> = new WeakMap()

export const ITERATE_KEY: unique symbol = Symbol(
  __DEV__ ? 'Object iterate' : '',
)
export const MAP_KEY_ITERATE_KEY: unique symbol = Symbol(
  __DEV__ ? 'Map keys iterate' : '',
)
export const ARRAY_ITERATE_KEY: unique symbol = Symbol(
  __DEV__ ? 'Array iterate' : '',
)

/**
 * 跟踪对响应式属性的访问。
 *
 * 这会检查当前正在运行的 effect，并将其记录为 dep，
 * 该 dep 记录所有依赖该响应式属性的 effect。
 *
 * @param target - 持有响应式属性的对象。
 * @param type - 对该响应式属性的访问类型。
 * @param key - 要跟踪的响应式属性标识。
 */
export function track(target: object, type: TrackOpTypes, key: unknown): void {
  if (shouldTrack && activeSub) {
    let depsMap = targetMap.get(target)
    if (!depsMap) {
      targetMap.set(target, (depsMap = new Map()))
    }
    let dep = depsMap.get(key)
    if (!dep) {
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
 * 查找与目标（或某个特定属性）相关的所有 dep，
 * 并触发其中存储的 effect。
 *
 * @param target - 响应式对象。
 * @param type - 需要触发 effect 的操作类型。
 * @param key - 可用于定位目标对象上的某个响应式属性。
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
  if (!depsMap) {
    // 从未被跟踪
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
