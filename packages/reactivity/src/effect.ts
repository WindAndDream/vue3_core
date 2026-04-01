import { extend, hasChanged } from '@vue/shared'
import type { ComputedRefImpl } from './computed'
import type { TrackOpTypes, TriggerOpTypes } from './constants'
import { type Link, globalVersion } from './dep'
import { activeEffectScope } from './effectScope'
import { warn } from './warning'

export type EffectScheduler = (...args: any[]) => any

export type DebuggerEvent = {
  effect: Subscriber
} & DebuggerEventExtraInfo

export type DebuggerEventExtraInfo = {
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

export interface DebuggerOptions {
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
}

export interface ReactiveEffectOptions extends DebuggerOptions {
  scheduler?: EffectScheduler
  allowRecurse?: boolean
  onStop?: () => void
}

export interface ReactiveEffectRunner<T = any> {
  (): T
  effect: ReactiveEffect
}

export let activeSub: Subscriber | undefined // 全局当前正在运行的副作用

export enum EffectFlags {
  /**
   * 仅 ReactiveEffect 使用
   */
  ACTIVE = 1 << 0, // 标记 effect 是否可以被触发执行。当 effect 被停止（stop）后，这个标志会被清除。
  RUNNING = 1 << 1, // 防止在 effect 执行期间的某些操作引起混乱，比如避免重复执行。
  TRACKING = 1 << 2, // 控制是否建立响应式依赖关系。某些情况下需要临时暂停依赖收集。
  NOTIFIED = 1 << 3, // 避免同一个 effect 在一轮更新中被多次加入调度队列。
  DIRTY = 1 << 4, // 主要用于 computed，标记计算属性的缓存是否过期。
  ALLOW_RECURSE = 1 << 5, // 控制 effect 在执行期间是否可以再次被自己触发。
  PAUSED = 1 << 6, // 暂时阻止 effect 参与调度执行，但不会停止它。
  EVALUATED = 1 << 7, // 判断 effect 是否已经初始化执行过，用于某些初始化逻辑。
}

/**
 * Subscriber 是一种跟踪（或订阅）依赖列表的类型。
 *
 */
export interface Subscriber extends DebuggerOptions {
  /**
   * @internal
   */
  deps?: Link // 当前 subscriber 持有的依赖 Link 链表头，表示“它依赖了哪些 dep”
  /**
   * @internal
   */
  depsTail?: Link // 上述依赖 Link 链表的尾节点
  /**
   * @internal
   */
  flags: EffectFlags // 当前 subscriber 的位标记状态
  /**
   * @internal
   */
  next?: Subscriber // 批处理队列里的下一个 subscriber，用于把它们串成队列
  /**
   * @internal
   */
  notify(): true | void // 被 dep 通知；返回 true 表示这是 computed，调用方还要继续通知它自己的 dep（计算属性即是依赖也是订阅者）
}

const pausedQueueEffects = new WeakSet<ReactiveEffect>()

export class ReactiveEffect<T = any>
  implements Subscriber, ReactiveEffectOptions
{
  /**
   * @internal
   */
  deps?: Link = undefined
  /**
   * @internal
   */
  depsTail?: Link = undefined
  /**
   * @internal
   */
  flags: EffectFlags = EffectFlags.ACTIVE | EffectFlags.TRACKING
  /**
   * @internal
   */
  next?: Subscriber = undefined
  /**
   * @internal
   */
  cleanup?: () => void = undefined // 在副作用运行前和stop前都会触发一次的清除回调

  scheduler?: EffectScheduler = undefined // 调度器，如果存在，在 trigger 时会优先走调度器
  onStop?: () => void // 在副作用调用 stop 方法时会触发 onStop 回调
  onTrack?: (event: DebuggerEvent) => void // 开发调试使用
  onTrigger?: (event: DebuggerEvent) => void // 开发调试使用

  constructor(public fn: () => T) {
    // 副作用作用域
    if (activeEffectScope && activeEffectScope.active) {
      activeEffectScope.effects.push(this)
    }
  }

  // 暂停
  pause(): void {
    this.flags |= EffectFlags.PAUSED
  }

  // 恢复
  resume(): void {
    if (this.flags & EffectFlags.PAUSED) {
      this.flags &= ~EffectFlags.PAUSED
      if (pausedQueueEffects.has(this)) {
        pausedQueueEffects.delete(this)
        this.trigger()
      }
    }
  }

  /**
   * @internal
   */
  // 通知
  notify(): void {
    if (
      this.flags & EffectFlags.RUNNING &&
      !(this.flags & EffectFlags.ALLOW_RECURSE)
    ) {
      return
    }
    if (!(this.flags & EffectFlags.NOTIFIED)) {
      batch(this)
    }
  }

  run(): T {
    // TODO cleanupEffect（待实现）

    // 判断副作用是否还是存活状态
    if (!(this.flags & EffectFlags.ACTIVE)) {
      // 在清理期间被停止
      return this.fn()
    }

    this.flags |= EffectFlags.RUNNING // 当前订阅者的状态为运行中
    cleanupEffect(this) //
    prepareDeps(this) //
    const prevEffect = activeSub // 上一个订阅者
    const prevShouldTrack = shouldTrack // 上一个订阅者追踪状态
    activeSub = this // 当前活跃的订阅者
    shouldTrack = true

    try {
      return this.fn()
    } finally {
      if (__DEV__ && activeSub !== this) {
        warn(
          'Active effect was not restored correctly - ' +
            'this is likely a Vue internal bug.',
        )
      }
      cleanupDeps(this)
      activeSub = prevEffect
      shouldTrack = prevShouldTrack
      this.flags &= ~EffectFlags.RUNNING
    }
  }

  stop(): void {
    if (this.flags & EffectFlags.ACTIVE) {
      for (let link = this.deps; link; link = link.nextDep) {
        removeSub(link)
      }
      this.deps = this.depsTail = undefined
      cleanupEffect(this)
      this.onStop && this.onStop()
      this.flags &= ~EffectFlags.ACTIVE
    }
  }

  trigger(): void {
    if (this.flags & EffectFlags.PAUSED) {
      pausedQueueEffects.add(this) // 暂停
    } else if (this.scheduler) {
      this.scheduler() // 调度器
    } else {
      this.runIfDirty()
    }
  }

  /**
   * @internal
   */
  runIfDirty(): void {
    if (isDirty(this)) {
      this.run()
    }
  }

  get dirty(): boolean {
    return isDirty(this)
  }
}

/**
 * 用于调试
 */
// function printDeps(sub: Subscriber) {
//   let d = sub.deps
//   let ds = []
//   while (d) {
//     ds.push(d)
//     d = d.nextDep
//   }
//   return ds.map(d => ({
//     id: d.id,
//     prev: d.prevDep?.id,
//     next: d.nextDep?.id,
//   }))
// }

// 用于保证单次触发时，保证触发链的顺序、去重和状态一致性
let batchDepth = 0
let batchedSub: Subscriber | undefined
let batchedComputed: Subscriber | undefined

export function batch(sub: Subscriber, isComputed = false): void {
  sub.flags |= EffectFlags.NOTIFIED // 设置已通知位标记，避免重复
  // 计算属性就入计算属性的批次
  if (isComputed) {
    sub.next = batchedComputed
    batchedComputed = sub
    return
  }
  sub.next = batchedSub // 入批次
  batchedSub = sub
}

/**
 * @internal
 */
export function startBatch(): void {
  batchDepth++
}

/**
 * 当所有批处理结束时运行已批处理的 effect
 * @internal
 */
export function endBatch(): void {
  if (--batchDepth > 0) {
    return
  }

  if (batchedComputed) {
    let e: Subscriber | undefined = batchedComputed
    batchedComputed = undefined
    while (e) {
      const next: Subscriber | undefined = e.next
      e.next = undefined
      e.flags &= ~EffectFlags.NOTIFIED
      e = next
    }
  }

  let error: unknown
  while (batchedSub) {
    let e: Subscriber | undefined = batchedSub
    batchedSub = undefined
    while (e) {
      const next: Subscriber | undefined = e.next
      e.next = undefined
      e.flags &= ~EffectFlags.NOTIFIED
      if (e.flags & EffectFlags.ACTIVE) {
        try {
          // ACTIVE 标志仅用于 effect
          ;(e as ReactiveEffect).trigger()
        } catch (err) {
          if (!error) error = err
        }
      }
      e = next
    }
  }

  if (error) throw error
}

// 重新执行前的依赖预处理
function prepareDeps(sub: Subscriber) {
  // 在重新执行 sub 之前，先把上一轮的旧依赖全部标记为“本轮暂未使用”
  for (let link = sub.deps; link; link = link.nextDep) {
    // -1 表示这条旧依赖还没有在本轮执行中被重新访问到
    // 如果后续 track() 又访问到它，会把 version 恢复为 dep.version
    // 执行结束后仍为 -1 的 link，会在 cleanupDeps() 中被移除
    link.version = -1

    // 保存 dep 之前的 activeLink，便于 cleanupDeps() 时恢复
    link.prevActiveLink = link.dep.activeLink

    // 先把 dep.activeLink 指向这条旧 link
    // 这样本轮再次访问同一个 dep 时，可以直接复用旧 link，而不是新建
    link.dep.activeLink = link
  }
}

function cleanupDeps(sub: Subscriber) {
  // 清理未使用的 deps
  // Cleanup unused deps
  let head
  let tail = sub.depsTail
  let link = tail
  while (link) {
    const prev = link.prevDep
    if (link.version === -1) {
      if (link === tail) tail = prev
      // 未使用 - 从 dep 的订阅 effect 列表中移除
      removeSub(link)
      // 同时从该 effect 的 dep 列表中移除
      removeDep(link)
    } else {
      // 新的头结点是最后一个未被移除的节点
      // （来自双向链表）
      head = link
    }

    // 如果有，恢复之前的 active link
    link.dep.activeLink = link.prevActiveLink
    link.prevActiveLink = undefined
    link = prev
  }
  // 设置新的头尾
  sub.deps = head
  sub.depsTail = tail
}

function isDirty(sub: Subscriber): boolean {
  for (let link = sub.deps; link; link = link.nextDep) {
    if (
      // link.version：sub 上一次追踪这个依赖时，记下来的版本号快照
      // link.dep.version：这个依赖现在的最新版本号
      link.dep.version !== link.version ||
      // 判断 computed 是否发生变化、变化之后的值是否不一样了，才会重新计算
      (link.dep.computed &&
        (refreshComputed(link.dep.computed) ||
          link.dep.version !== link.version))
    ) {
      return true
    }
  }
  // @ts-expect-error 仅用于向后兼容，库会手动设置
  // 该标志 - 例如 Pinia 的测试模块
  if (sub._dirty) {
    return true
  }
  return false
}

/**
 * 返回 false 表示计算属性的值没有变化，不用重算
 * @internal
 */
export function refreshComputed(computed: ComputedRefImpl): undefined {
  // 已经挂在依赖中，并且未标脏，则直接信任缓存
  if (
    computed.flags & EffectFlags.TRACKING &&
    !(computed.flags & EffectFlags.DIRTY)
  ) {
    return
  }

  computed.flags &= ~EffectFlags.DIRTY // 清除脏状态

  // 当自上次刷新后没有响应式变更时，使用全局版本的快速路径
  if (computed.globalVersion === globalVersion) {
    return
  }
  computed.globalVersion = globalVersion

  // 不是 SSR
  // 已经至少求值过一次
  // 没有 deps 依赖
  // 不为脏
  // 满足以上条件也代表这个计算属性没发生变化，直接返回
  if (
    !computed.isSSR &&
    computed.flags & EffectFlags.EVALUATED &&
    ((!computed.deps && !(computed as any)._dirty) || !isDirty(computed))
  ) {
    return
  }

  // 设置为运行中状态
  computed.flags |= EffectFlags.RUNNING

  const dep = computed.dep // 保存计算属性依赖（计算属性本身）

  // 活跃的订阅者、追踪状态保存
  const prevSub = activeSub
  const prevShouldTrack = shouldTrack
  activeSub = computed
  shouldTrack = true

  try {
    prepareDeps(computed)
    const value = computed.fn(computed._value)
    if (dep.version === 0 || hasChanged(value, computed._value)) {
      computed.flags |= EffectFlags.EVALUATED
      computed._value = value
      dep.version++
    }
  } catch (err) {
    dep.version++
    throw err
  } finally {
    activeSub = prevSub
    shouldTrack = prevShouldTrack
    cleanupDeps(computed)
    computed.flags &= ~EffectFlags.RUNNING // 移除运行中状态
  }
}

function removeSub(link: Link, soft = false) {
  const { dep, prevSub, nextSub } = link
  if (prevSub) {
    prevSub.nextSub = nextSub
    link.prevSub = undefined
  }
  if (nextSub) {
    nextSub.prevSub = prevSub
    link.nextSub = undefined
  }
  if (__DEV__ && dep.subsHead === link) {
    // 之前是头结点，将新的头指向 next
    dep.subsHead = nextSub
  }

  if (dep.subs === link) {
    // 之前是尾结点，将新的尾指向 prev
    dep.subs = prevSub

    if (!prevSub && dep.computed) {
      // 如果是 computed，从它的所有 deps 退订，以便该 computed 及其
      // 值可以被 GC
      dep.computed.flags &= ~EffectFlags.TRACKING
      for (let l = dep.computed.deps; l; l = l.nextDep) {
        // 这里只做“软”退订，因为 computed 仍然保持对 deps 的引用，dep 不应减少其订阅计数
        removeSub(l, true)
      }
    }
  }

  if (!soft && !--dep.sc && dep.map) {
    // #11979
    // 属性 dep 不再有 effect 订阅者，删除它
    // 这主要针对对象仍在内存中，但只有
    // 部分属性在某一时刻被跟踪的情况
    dep.map.delete(dep.key)
  }
}

function removeDep(link: Link) {
  const { prevDep, nextDep } = link
  if (prevDep) {
    prevDep.nextDep = nextDep
    link.prevDep = undefined
  }
  if (nextDep) {
    nextDep.prevDep = prevDep
    link.nextDep = undefined
  }
}

export function effect<T = any>(
  fn: () => T,
  options?: ReactiveEffectOptions,
): ReactiveEffectRunner<T> {
  if ((fn as ReactiveEffectRunner).effect instanceof ReactiveEffect) {
    fn = (fn as ReactiveEffectRunner).effect.fn
  }

  const e = new ReactiveEffect(fn)
  if (options) {
    extend(e, options)
  }
  try {
    e.run()
  } catch (err) {
    e.stop()
    throw err
  }
  const runner = e.run.bind(e) as ReactiveEffectRunner
  runner.effect = e
  return runner
}

/**
 * 停止与给定 runner 关联的 effect。
 *
 * @param runner - 与该 effect 关联、用于停止跟踪的 runner。
 */
export function stop(runner: ReactiveEffectRunner): void {
  runner.effect.stop()
}

/**
 * @internal
 */
export let shouldTrack = true // 当前执行上下文里是否允许做依赖收集
const trackStack: boolean[] = [] // 用于追踪嵌套的栈，毕竟如果嵌套需要多个暂停和启动需要栈来维护状态

export function pauseTracking(): void {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

/**
 * 重新启用 effect 跟踪（如果之前暂停）。
 */
export function enableTracking(): void {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

export function resetTracking(): void {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

/**
 * 为当前活跃的 effect 注册一个清理函数
 * 清理函数会在下一次 effect 运行前，或 effect 调用 stop 方法时调用
 *
 * @param fn - 要注册的清理函数
 * @param failSilently - 若为 `true`，在没有 active effect 时调用不会警告
 */
export function onEffectCleanup(fn: () => void, failSilently = false): void {
  if (activeSub instanceof ReactiveEffect) {
    activeSub.cleanup = fn
  } else if (__DEV__ && !failSilently) {
    warn(
      `onEffectCleanup() was called when there was no active effect` +
        ` to associate with.`,
    )
  }
}

function cleanupEffect(e: ReactiveEffect) {
  const { cleanup } = e
  e.cleanup = undefined
  if (cleanup) {
    // 在没有 active effect 的情况下执行清理
    const prevSub = activeSub
    activeSub = undefined
    try {
      cleanup()
    } finally {
      activeSub = prevSub
    }
  }
}
