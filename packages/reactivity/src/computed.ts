import { isFunction } from '@vue/shared'
import {
  type DebuggerEvent,
  type DebuggerOptions,
  EffectFlags,
  type Subscriber,
  activeSub,
  batch,
  refreshComputed,
} from './effect'
import type { Ref } from './ref'
import { warn } from './warning'
import { Dep, type Link, globalVersion } from './dep'
import { ReactiveFlags, TrackOpTypes } from './constants'

declare const ComputedRefSymbol: unique symbol
declare const WritableComputedRefSymbol: unique symbol

interface BaseComputedRef<T, S = T> extends Ref<T, S> {
  [ComputedRefSymbol]: true
  /**
   * @deprecated computed 不再使用 effect
   */
  effect: ComputedRefImpl
}

// 计算属性传入 getter 则返回只读值
export interface ComputedRef<T = any> extends BaseComputedRef<T> {
  readonly value: T
}

// 计算属性传入读写则返回可写值
export interface WritableComputedRef<T, S = T> extends BaseComputedRef<T, S> {
  [WritableComputedRefSymbol]: true
}

export type ComputedGetter<T> = (oldValue?: T) => T
export type ComputedSetter<T> = (newValue: T) => void

// 可写的计算属性
export interface WritableComputedOptions<T, S = T> {
  get: ComputedGetter<T>
  set: ComputedSetter<S>
}

/**
 * @private 由 @vue/reactivity 导出供 Vue 核心使用，但不从主 vue 包导出
 */
export class ComputedRefImpl<T = any> implements Subscriber {
  /**
   * @internal
   */
  _value: any = undefined // 计算属性缓存值
  /**
   * @internal
   */
  readonly dep: Dep = new Dep(this) // 计算属性作为依赖被使用时，就需要使用到 dep
  /**
   * @internal
   */
  readonly __v_isRef = true
  // TODO isolatedDeclarations ReactiveFlags.IS_REF（待处理）
  /**
   * @internal
   */
  readonly __v_isReadonly: boolean
  // TODO isolatedDeclarations ReactiveFlags.IS_READONLY（待处理）
  // computed 同时也是一个订阅者，用于跟踪其他 deps
  /**
   * @internal
   */
  deps?: Link = undefined // 当前 subscriber 持有的依赖 Link 链表头，表示“它依赖了哪些 dep”
  /**
   * @internal
   */
  depsTail?: Link = undefined // 上述依赖 Link 链表的尾节点
  /**
   * @internal
   */
  flags: EffectFlags = EffectFlags.DIRTY // 计算属性的位标志
  /**
   * @internal
   */
  globalVersion: number = globalVersion - 1 // 全局版本状态
  /**
   * @internal
   */
  isSSR: boolean // 是否为 ssr
  /**
   * @internal
   */
  next?: Subscriber = undefined

  // 向后兼容
  effect: this = this
  // 仅开发环境
  onTrack?: (event: DebuggerEvent) => void
  // 仅开发环境
  onTrigger?: (event: DebuggerEvent) => void

  /**
   * 仅开发环境
   * @internal
   */
  _warnRecursive?: boolean

  constructor(
    public fn: ComputedGetter<T>,
    private readonly setter: ComputedSetter<T> | undefined,
    isSSR: boolean,
  ) {
    this[ReactiveFlags.IS_READONLY] = !setter
    this.isSSR = isSSR
  }

  /**
   * @internal
   *
   * 依赖通知，说明计算属性脏了，需要重新计算
   */
  notify(): true | void {
    this.flags |= EffectFlags.DIRTY // 追加脏的位标志

    // 避免重复通知、无线递归自己
    if (!(this.flags & EffectFlags.NOTIFIED) && activeSub !== this) {
      batch(this, true)
      return true
    } else if (__DEV__) {
      // TODO 警告
    }
  }

  get value(): T {
    const link = __DEV__
      ? this.dep.track({
          target: this,
          type: TrackOpTypes.GET,
          key: 'value',
        })
      : this.dep.track()
    refreshComputed(this)
    // 评估后同步版本
    if (link) {
      link.version = this.dep.version
    }
    return this._value
  }

  set value(newValue) {
    if (this.setter) {
      this.setter(newValue)
    } else if (__DEV__) {
      warn('Write operation failed: computed value is readonly')
    }
  }
}

/**
 * 接收一个 getter 函数并返回只读的响应式 ref 对象，其值来自该 getter。
 * 也可以接收包含 get 和 set 函数的对象以创建可写的 ref 对象。
 *
 * @example
 * ```js
 * // 创建只读 computed ref：
 * const count = ref(1)
 * const plusOne = computed(() => count.value + 1)
 *
 * console.log(plusOne.value) // 2
 * plusOne.value++ // 错误
 * ```
 *
 * ```js
 * // 创建可写 computed ref：
 * const count = ref(1)
 * const plusOne = computed({
 *   get: () => count.value + 1,
 *   set: (val) => {
 *     count.value = val - 1
 *   }
 * })
 *
 * plusOne.value = 1
 * console.log(count.value) // 0
 * ```
 *
 * @param getter - 生成下一个值的函数。
 * @param debugOptions - 用于调试。参见 {@link https://vuejs.org/guide/extras/reactivity-in-depth.html#computed-debugging}.
 * @see {@link https://vuejs.org/api/reactivity-core.html#computed}
 */
export function computed<T>(
  getter: ComputedGetter<T>,
  debugOptions?: DebuggerOptions,
): ComputedRef<T>
export function computed<T, S = T>(
  options: WritableComputedOptions<T, S>,
  debugOptions?: DebuggerOptions,
): WritableComputedRef<T, S>
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>,
  debugOptions?: DebuggerOptions,
  isSSR = false,
) {
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T> | undefined

  if (isFunction(getterOrOptions)) {
    getter = getterOrOptions
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  const cRef = new ComputedRefImpl(getter, setter, isSSR)

  if (__DEV__ && debugOptions && !isSSR) {
    cRef.onTrack = debugOptions.onTrack
    cRef.onTrigger = debugOptions.onTrigger
  }

  return cRef as any
}
