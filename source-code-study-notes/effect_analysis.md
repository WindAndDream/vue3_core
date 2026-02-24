# Vue 3 `effect.ts` 源码分析报告

`effect.ts` 是 Vue 3 响应式系统的心脏。它定义了 `ReactiveEffect` 类和 `effect` 函数，实现了“副作用管理”和“依赖收集/触发更新”的核心机制。

## 1. 核心概念

-   **Dep (Dependency)**: 依赖，通常对应一个响应式对象的属性。每个属性都有一个 `Dep`，里面存储了所有订阅了这个属性的 `Effect`。
-   **Effect (Side Effect)**: 副作用，通常是一个函数。当它执行时，会读取响应式数据，从而被收集为依赖。当数据变化时，`Effect` 会重新执行。
-   **Subscriber**: 订阅者接口，`ReactiveEffect` 实现了这个接口。
-   **Link**: 连接 `Dep` 和 `Subscriber` 的双向链表节点。Vue 3.5 引入了这种双向链表结构来优化依赖管理的性能（比起 Vue 3.0 的 `Set` 结构，内存占用更低，清理更高效）。

## 2. 关键类与函数

### `ReactiveEffect` 类
这是响应式副作用的载体。
-   **`run()`**: 执行副作用函数。执行前会开启依赖收集模式 (`shouldTrack = true`)，将自己设置为 `activeSub`。
-   **`track()` / `trigger()`**: 虽然这两个函数逻辑主要在 `dep.ts` 和 `reactive.ts` 中触发，但 `ReactiveEffect` 是被 track 的对象，也是 trigger 的目标。
-   **`notify()`**: 当依赖变更时，Dep 会调用 `notify()` 通知 Effect。
-   **`stop()`**: 停止副作用，清除所有依赖连接。

### `effect` 函数
这是用户使用的 API，用于创建一个 `ReactiveEffect` 并立即运行它（默认情况下）。

### 依赖清理 (`cleanupDeps`)
Vue 3.5 引入了更智能的依赖清理机制。每次 Effect 运行时，不会简单粗暴地清空所有依赖重新收集，而是通过 `version` 版本号对比，只处理变动的依赖。

## 3. 代码注解

下面是 `effect.ts` 的详细注释版：

```typescript
import { extend, hasChanged } from '@vue/shared'
import type { ComputedRefImpl } from './computed'
import type { TrackOpTypes, TriggerOpTypes } from './constants'
import { type Link, globalVersion } from './dep'
import { activeEffectScope } from './effectScope'
import { warn } from './warning'

// ... (类型定义省略)

// 当前正在执行的订阅者 (Effect 或 Computed)
export let activeSub: Subscriber | undefined

// Effect 的状态标志位（位运算优化）
export enum EffectFlags {
  ACTIVE = 1 << 0,       // 激活状态
  RUNNING = 1 << 1,      // 正在运行
  TRACKING = 1 << 2,     // 正在收集依赖
  NOTIFIED = 1 << 3,     // 已被通知需要更新
  DIRTY = 1 << 4,        // 脏状态（计算属性用）
  ALLOW_RECURSE = 1 << 5,// 允许递归调用
  PAUSED = 1 << 6,       // 暂停
  EVALUATED = 1 << 7,    // 已计算（计算属性用）
}

/**
 * 订阅者接口，ReactiveEffect 实现了它
 * 使用双向链表来存储依赖 (Link 节点)
 */
export interface Subscriber extends DebuggerOptions {
  deps?: Link        // 指向依赖链表的头
  depsTail?: Link    // 指向依赖链表的尾
  flags: EffectFlags
  next?: Subscriber  // 用于批量更新时的链表
  notify(): true | void // 依赖变更时的回调
}

// -------------------------------------------------------------
// ReactiveEffect 类: 响应式系统的核心单元
// -------------------------------------------------------------
export class ReactiveEffect<T = any>
  implements Subscriber, ReactiveEffectOptions
{
  deps?: Link = undefined
  depsTail?: Link = undefined
  flags: EffectFlags = EffectFlags.ACTIVE | EffectFlags.TRACKING
  next?: Subscriber = undefined
  cleanup?: () => void = undefined // 清理回调 (onEffectCleanup)

  scheduler?: EffectScheduler = undefined // 调度器 (如 Vue 组件的异步更新)
  
  constructor(public fn: () => T) {
    // 如果在 EffectScope 中，则注册自己，以便随 Scope 一起停止
    if (activeEffectScope && activeEffectScope.active) {
      activeEffectScope.effects.push(this)
    }
  }

  // 通知更新
  notify(): void {
    // 如果正在运行且不允许递归，则忽略
    if (
      this.flags & EffectFlags.RUNNING &&
      !(this.flags & EffectFlags.ALLOW_RECURSE)
    ) {
      return
    }
    // 防止重复通知
    if (!(this.flags & EffectFlags.NOTIFIED)) {
      batch(this) // 加入批量更新队列
    }
  }

  // 执行副作用函数
  run(): T {
    // 如果已停止 (非 ACTIVE)，直接执行函数而不收集依赖
    if (!(this.flags & EffectFlags.ACTIVE)) {
      return this.fn()
    }

    // 设置运行标志
    this.flags |= EffectFlags.RUNNING
    // 执行上一次运行注册的清理函数
    cleanupEffect(this)
    // 准备依赖收集 (将现有依赖标记为可能是陈旧的)
    prepareDeps(this)
    
    // 保存上下文，准备切换 activeSub
    const prevEffect = activeSub
    const prevShouldTrack = shouldTrack
    activeSub = this
    shouldTrack = true

    try {
      // *** 真正执行用户的函数，触发 Getter 进行依赖收集 ***
      return this.fn()
    } finally {
      // 恢复上下文
      if (__DEV__ && activeSub !== this) {
        warn('Active effect was not restored correctly - this is likely a Vue internal bug.')
      }
      // 清理掉本次运行没有用到的旧依赖
      cleanupDeps(this)
      activeSub = prevEffect
      shouldTrack = prevShouldTrack
      this.flags &= ~EffectFlags.RUNNING
    }
  }

  // 停止 Effect
  stop(): void {
    if (this.flags & EffectFlags.ACTIVE) {
      // 遍历链表，断开所有依赖连接
      for (let link = this.deps; link; link = link.nextDep) {
        removeSub(link)
      }
      this.deps = this.depsTail = undefined
      cleanupEffect(this)
      this.onStop && this.onStop()
      this.flags &= ~EffectFlags.ACTIVE // 取消激活状态
    }
  }

  // 触发器：决定如何运行 Effect
  trigger(): void {
    if (this.flags & EffectFlags.PAUSED) {
      pausedQueueEffects.add(this)
    } else if (this.scheduler) {
      // 如果有调度器（例如组件更新），交给调度器处理
      this.scheduler()
    } else {
      // 否则直接运行（同步 Effect）
      this.runIfDirty()
    }
  }
}

// -------------------------------------------------------------
// 批量更新机制 (Batching)
// -------------------------------------------------------------
let batchDepth = 0
let batchedSub: Subscriber | undefined
let batchedComputed: Subscriber | undefined

export function batch(sub: Subscriber, isComputed = false): void {
  sub.flags |= EffectFlags.NOTIFIED
  // 将 Effect 加入单向链表队列
  if (isComputed) {
    sub.next = batchedComputed
    batchedComputed = sub
    return
  }
  sub.next = batchedSub
  batchedSub = sub
}

export function startBatch(): void {
  batchDepth++
}

// 结束批量处理，实际触发 Effect
export function endBatch(): void {
  if (--batchDepth > 0) {
    return
  }
  // ... (先处理 computed，再处理普通 effects，执行 trigger())
  // 代码略...
}

// -------------------------------------------------------------
// 依赖链表管理 (核心优化)
// -------------------------------------------------------------

// 运行前：将所有依赖标记为 version = -1
function prepareDeps(sub: Subscriber) {
  for (let link = sub.deps; link; link = link.nextDep) {
    link.version = -1 
    link.prevActiveLink = link.dep.activeLink
    link.dep.activeLink = link
  }
}

// 运行后：移除仍然是 version = -1 的依赖（说明本次运行没用到）
function cleanupDeps(sub: Subscriber) {
  let head
  let tail = sub.depsTail
  let link = tail
  while (link) {
    const prev = link.prevDep
    if (link.version === -1) {
      // 这个依赖本次没被收集到，说明不需要了，移除
      if (link === tail) tail = prev
      removeSub(link)
      removeDep(link)
    } else {
      head = link // 新的头节点
    }
    // ... 恢复现场
    link.dep.activeLink = link.prevActiveLink
    link.prevActiveLink = undefined
    link = prev
  }
  sub.deps = head
  sub.depsTail = tail
}

// -------------------------------------------------------------
// 用户 API: effect
// -------------------------------------------------------------
export function effect<T = any>(
  fn: () => T,
  options?: ReactiveEffectOptions,
): ReactiveEffectRunner<T> {
  // 如果传入的已经是 effect runner，取由于原始函数
  if ((fn as ReactiveEffectRunner).effect instanceof ReactiveEffect) {
    fn = (fn as ReactiveEffectRunner).effect.fn
  }

  const e = new ReactiveEffect(fn)
  if (options) {
    extend(e, options)
  }
  try {
    // 默认情况立即执行一次，进行依赖收集
    e.run()
  } catch (err) {
    e.stop()
    throw err
  }
  // 返回 runner 函数，用户可以手动再次调用
  const runner = e.run.bind(e) as ReactiveEffectRunner
  runner.effect = e
  return runner
}
```
