import { TrackOpTypes } from './constants'
import { endBatch, pauseTracking, resetTracking, startBatch } from './effect'
import {
  isProxy,
  isReactive,
  isReadonly,
  isShallow,
  toRaw,
  toReactive,
  toReadonly,
} from './reactive'
import { ARRAY_ITERATE_KEY, track } from './dep'
import { isArray } from '@vue/shared'

/**
 * Track array iteration and return:
 * - if input is reactive: a cloned raw array with reactive values
 * - if input is non-reactive or shallowReactive: the original raw array
 */
/**
 * 用于那些需要返回响应式元素的数组方法
 * 输入的数组为响应式：返回包含响应式值的数组
 * 如果为非响应式/浅层响应式：返回原始数组
 */
export function reactiveReadArray<T>(array: T[]): T[] {
  const raw = toRaw(array)
  if (raw === array) return raw
  track(raw, TrackOpTypes.ITERATE, ARRAY_ITERATE_KEY)
  return isShallow(array) ? raw : raw.map(toReactive)
}

/**
 * 追踪数组迭代依赖，返回数组原始对象
 * 用于只读结构的数组方法（join/indexOf...）
 */
export function shallowReadArray<T>(arr: T[]): T[] {
  track((arr = toRaw(arr)), TrackOpTypes.ITERATE, ARRAY_ITERATE_KEY)
  return arr
}

// 对象中的成员转为响应式（如果成员不是 object 类型则不会发生任何变化）
function toWrapped(target: unknown, item: unknown) {
  // 判断是否为只读对象
  if (isReadonly(target)) {
    // 判断目标的每项成员是否为响应式，如果不是则添加只读响应式，是的话直接添加只读即可
    return isReactive(target) ? toReadonly(toReactive(item)) : toReadonly(item)
  }
  return toReactive(item) // 转换成员为响应式
}

// 特殊处理过后的数组方法
export const arrayInstrumentations: Record<string | symbol, Function> = <any>{
  __proto__: null,

  // 迭代方法
  [Symbol.iterator]() {
    return iterator(this, Symbol.iterator, item => toWrapped(this, item))
  },

  concat(...args: unknown[]) {
    return reactiveReadArray(this).concat(
      ...args.map(x => (isArray(x) ? reactiveReadArray(x) : x)),
    )
  },

  entries() {
    return iterator(this, 'entries', (value: [number, unknown]) => {
      value[1] = toWrapped(this, value[1])
      return value
    })
  },

  every(
    fn: (item: unknown, index: number, array: unknown[]) => unknown,
    thisArg?: unknown,
  ) {
    return apply(this, 'every', fn, thisArg, undefined, arguments)
  },

  filter(
    fn: (item: unknown, index: number, array: unknown[]) => unknown,
    thisArg?: unknown,
  ) {
    return apply(
      this,
      'filter',
      fn,
      thisArg,
      v => v.map((item: unknown) => toWrapped(this, item)),
      arguments,
    )
  },

  find(
    fn: (item: unknown, index: number, array: unknown[]) => boolean,
    thisArg?: unknown,
  ) {
    return apply(
      this,
      'find',
      fn,
      thisArg,
      item => toWrapped(this, item),
      arguments,
    )
  },

  findIndex(
    fn: (item: unknown, index: number, array: unknown[]) => boolean,
    thisArg?: unknown,
  ) {
    return apply(this, 'findIndex', fn, thisArg, undefined, arguments)
  },

  findLast(
    fn: (item: unknown, index: number, array: unknown[]) => boolean,
    thisArg?: unknown,
  ) {
    return apply(
      this,
      'findLast',
      fn,
      thisArg,
      item => toWrapped(this, item),
      arguments,
    )
  },

  findLastIndex(
    fn: (item: unknown, index: number, array: unknown[]) => boolean,
    thisArg?: unknown,
  ) {
    return apply(this, 'findLastIndex', fn, thisArg, undefined, arguments)
  },

  // flat, flatMap could benefit from ARRAY_ITERATE but are not straight-forward to implement

  forEach(
    fn: (item: unknown, index: number, array: unknown[]) => unknown,
    thisArg?: unknown,
  ) {
    return apply(this, 'forEach', fn, thisArg, undefined, arguments)
  },

  includes(...args: unknown[]) {
    return searchProxy(this, 'includes', args)
  },

  indexOf(...args: unknown[]) {
    return searchProxy(this, 'indexOf', args)
  },

  join(separator?: string) {
    return reactiveReadArray(this).join(separator)
  },

  // keys() iterator only reads `length`, no optimization required

  lastIndexOf(...args: unknown[]) {
    return searchProxy(this, 'lastIndexOf', args)
  },

  map(
    fn: (item: unknown, index: number, array: unknown[]) => unknown,
    thisArg?: unknown,
  ) {
    return apply(this, 'map', fn, thisArg, undefined, arguments)
  },

  pop() {
    return noTracking(this, 'pop')
  },

  push(...args: unknown[]) {
    return noTracking(this, 'push', args)
  },

  reduce(
    fn: (
      acc: unknown,
      item: unknown,
      index: number,
      array: unknown[],
    ) => unknown,
    ...args: unknown[]
  ) {
    return reduce(this, 'reduce', fn, args)
  },

  reduceRight(
    fn: (
      acc: unknown,
      item: unknown,
      index: number,
      array: unknown[],
    ) => unknown,
    ...args: unknown[]
  ) {
    return reduce(this, 'reduceRight', fn, args)
  },

  shift() {
    return noTracking(this, 'shift')
  },

  // slice could use ARRAY_ITERATE but also seems to beg for range tracking

  some(
    fn: (item: unknown, index: number, array: unknown[]) => unknown,
    thisArg?: unknown,
  ) {
    return apply(this, 'some', fn, thisArg, undefined, arguments)
  },

  splice(...args: unknown[]) {
    return noTracking(this, 'splice', args)
  },

  toReversed() {
    // @ts-expect-error user code may run in es2016+
    return reactiveReadArray(this).toReversed()
  },

  toSorted(comparer?: (a: unknown, b: unknown) => number) {
    // @ts-expect-error user code may run in es2016+
    return reactiveReadArray(this).toSorted(comparer)
  },

  toSpliced(...args: unknown[]) {
    // @ts-expect-error user code may run in es2016+
    return (reactiveReadArray(this).toSpliced as any)(...args)
  },

  unshift(...args: unknown[]) {
    return noTracking(this, 'unshift', args)
  },

  values() {
    return iterator(this, 'values', item => toWrapped(this, item))
  },
}

// instrument iterators to take ARRAY_ITERATE dependency
function iterator(
  self: unknown[],
  method: keyof Array<unknown>,
  wrapValue: (value: any) => unknown,
) {
  // note that taking ARRAY_ITERATE dependency here is not strictly equivalent
  // to calling iterate on the proxied array.
  // creating the iterator does not access any array property:
  // it is only when .next() is called that length and indexes are accessed.
  // pushed to the extreme, an iterator could be created in one effect scope,
  // partially iterated in another, then iterated more in yet another.
  // given that JS iterator can only be read once, this doesn't seem like
  // a plausible use-case, so this tracking simplification seems ok.
  const arr = shallowReadArray(self) // 获取数组原始对象
  // 原生迭代器
  const iter = (arr[method] as any)() as IterableIterator<unknown> & {
    _next: IterableIterator<unknown>['next']
  }
  // 是响应式对象并且不是浅层，才重写 iter.next
  if (arr !== self && !isShallow(self)) {
    iter._next = iter.next
    iter.next = () => {
      const result = iter._next()
      if (!result.done) {
        // 把值再包裹一层响应式（如果是原始数据类型则不变）
        result.value = wrapValue(result.value)
      }
      return result
    }
  }
  return iter
}

// 在代码库中我们强制执行 ES2016 规范，但用户代码可能在更高版本的环境中运行
type ArrayMethods = keyof Array<any> | 'findLast' | 'findLastIndex'

const arrayProto = Array.prototype
// instrument functions that read (potentially) all items
// to take ARRAY_ITERATE dependency
function apply(
  self: unknown[],
  method: ArrayMethods,
  fn: (item: unknown, index: number, array: unknown[]) => unknown,
  thisArg?: unknown,
  wrappedRetFn?: (result: any) => unknown,
  args?: IArguments,
) {
  const arr = shallowReadArray(self)

  // 判断“当前是不是深层响应式/只读代理数组”
  const needsWrap = arr !== self && !isShallow(self)
  // @ts-expect-error our code is limited to es2016 but user code is not
  const methodFn = arr[method]

  // #11759
  // If the method being called is from a user-extended Array, the arguments will be unknown
  // (unknown order and unknown parameter types). In this case, we skip the shallowReadArray
  // handling and directly call apply with self.
  // 如果用户自己扩展了数组方法，就对用户的扩展方法进行调用
  if (methodFn !== arrayProto[method as any]) {
    const result = methodFn.apply(self, args)
    return needsWrap ? toReactive(result) : result // 如果为深层非只读响应式则进行结果的包裹
  }

  let wrappedFn = fn // 调用数组方法传入的回调函数
  if (arr !== self) {
    // 需要响应式包裹
    if (needsWrap) {
      // 作用：深层代理数组时，回调收到的 item 不能是裸数据，必须经过 toWrapped(self, item)
      // 响应式数组 -> 元素转成 reactive
      // 只读数组 -> 元素转成 readonly
      // 同时第三个参数 array 传的是 self，也就是代理数组本身，而不是原始数组
      // 这样用户在回调里看到的行为才和直接操作响应式数组一致
      wrappedFn = function (this: unknown, item, index) {
        return fn.call(this, toWrapped(self, item), index, self)
      }
    } else if (fn.length > 2) {
      // 作用：这是浅响应式数组的优化分支
      // 浅响应式不需要包装元素，所以 item 原样传
      // 但如果用户回调声明了第三个参数（fn.length > 2），就把第三个参数改成 self，保证回调里拿到的 array 还是代理数组
      // 如果用户根本不用第三个参数，就没必要包一层函数
      wrappedFn = function (this: unknown, item, index) {
        return fn.call(this, item, index, self)
      }
    }
  }
  const result = methodFn.call(arr, wrappedFn, thisArg) // 执行原生数组方法
  // “返回值怎么包装”的策略函数。
  // 因为不同数组方法的返回值形态不同，有的是新数组，有的是单个元素，有的是布尔值/索引
  return needsWrap && wrappedRetFn ? wrappedRetFn(result) : result
}

// instrument reduce and reduceRight to take ARRAY_ITERATE dependency
function reduce(
  self: unknown[],
  method: keyof Array<any>,
  fn: (acc: unknown, item: unknown, index: number, array: unknown[]) => unknown,
  args: unknown[],
) {
  const arr = shallowReadArray(self)
  let wrappedFn = fn
  if (arr !== self) {
    if (!isShallow(self)) {
      wrappedFn = function (this: unknown, acc, item, index) {
        return fn.call(this, acc, toWrapped(self, item), index, self)
      }
    } else if (fn.length > 3) {
      // 如果说用户回调传入了第四个参数，九八第四个参数改为 self，确保拿到的还是代理数组
      wrappedFn = function (this: unknown, acc, item, index) {
        return fn.call(this, acc, item, index, self)
      }
    }
  }
  return (arr[method] as any)(wrappedFn, ...args)
}

// 专门给“基于值相等 / 对象身份比较”的查找方法使用
function searchProxy(
  self: unknown[],
  method: keyof Array<any>,
  args: unknown[],
) {
  const arr = toRaw(self) as any
  track(arr, TrackOpTypes.ITERATE, ARRAY_ITERATE_KEY)
  // we run the method using the original args first (which may be reactive)
  const res = arr[method](...args) // 先查一次

  // 如果传入的值没查到，并且值为代理的话
  if ((res === -1 || res === false) && isProxy(args[0])) {
    args[0] = toRaw(args[0]) // 获取原始值来查
    return arr[method](...args)
  }

  return res
}

// instrument length-altering mutation methods to avoid length being tracked
// which leads to infinite loops in some cases (#2137)
function noTracking(
  self: unknown[],
  method: keyof Array<any>,
  args: unknown[] = [],
) {
  pauseTracking() // 暂停依赖收集，避免死循环
  startBatch() // 启动批处理
  const res = (toRaw(self) as any)[method].apply(self, args)
  endBatch()
  resetTracking()
  return res
}
