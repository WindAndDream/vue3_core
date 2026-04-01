import {
  type Target,
  isReadonly,
  isShallow,
  toRaw,
  toReactive,
  toReadonly,
} from './reactive'
import { ITERATE_KEY, MAP_KEY_ITERATE_KEY, track, trigger } from './dep'
import { ReactiveFlags, TrackOpTypes, TriggerOpTypes } from './constants'
import {
  capitalize,
  extend,
  hasChanged,
  hasOwn,
  isMap,
  toRawType,
} from '@vue/shared'
import { warn } from './warning'

// 集合类型，可迭代和弱集合
type CollectionTypes = IterableCollections | WeakCollections

type IterableCollections = (Map<any, any> | Set<any>) & Target // Map/Set 对象
type WeakCollections = (WeakMap<any, any> | WeakSet<any>) & Target // WeakMap/WeakSet 对象
type MapTypes = (Map<any, any> | WeakMap<any, any>) & Target
type SetTypes = (Set<any> | WeakSet<any>) & Target

const toShallow = <T extends unknown>(value: T): T => value

// 获取原型
const getProto = <T extends CollectionTypes>(v: T): any =>
  Reflect.getPrototypeOf(v)

// 给 Map / Set 的迭代方法统一加上响应式外壳的工厂函数
function createIterableMethod(
  method: string | symbol, // 哪种迭代方法
  isReadonly: boolean, // 是不是只读
  isShallow: boolean, // 是不是浅层
) {
  return function (
    this: IterableCollections,
    ...args: unknown[]
  ): Iterable<unknown> & Iterator<unknown> {
    const target = this[ReactiveFlags.RAW] // 获取原始对象
    const rawTarget = toRaw(target) // 解包原始对象，因为原始对象也可能为代理
    const targetIsMap = isMap(rawTarget)

    // 判断方法的产出是否为“一对”，类似[[key, value], [key, value]...]
    const isPair =
      method === 'entries' || (method === Symbol.iterator && targetIsMap) // entries 方法或者 Map 的 Symbol.iterator 方法、

    // 判断是否为 Map.keys()，因为 keys() 只关心 key 集合是否变化，不该和 values()/entries() 共用同一种迭代依赖
    const isKeyOnly = method === 'keys' && targetIsMap
    const innerIterator = target[method](...args) // 底层真实迭代器

    // 根据只读/浅层的状态来决定包裹的函数
    // 浅层则直接返回：toShallow
    // 只读则包裹为只读：toReadonly
    // 否则包裹为响应式：toReactive
    const wrap = isShallow ? toShallow : isReadonly ? toReadonly : toReactive

    // 如果不是只读集合，就在“开始迭代”时收集依赖
    !isReadonly &&
      track(
        rawTarget,
        TrackOpTypes.ITERATE,
        isKeyOnly ? MAP_KEY_ITERATE_KEY : ITERATE_KEY,
      )

    // 返回一个自定义迭代器对象，而不是直接返回原生迭代器
    return {
      // 迭代协议
      next() {
        const { value, done } = innerIterator.next()
        return done
          ? { value, done } // 如果结束了则直接返回原始的值
          : {
              value: isPair ? [wrap(value[0]), wrap(value[1])] : wrap(value), // 如果是一对则包裹两个，否则直接包裹值
              done, // done 不为 true
            }
      },
      // 迭代协议，返回自身
      [Symbol.iterator]() {
        return this
      },
    }
  }
}

function createReadonlyMethod(type: TriggerOpTypes): Function {
  return function (this: CollectionTypes, ...args: unknown[]) {
    if (__DEV__) {
      const key = args[0] ? `on key "${args[0]}" ` : ``
      warn(
        `${capitalize(type)} operation ${key}failed: target is readonly.`,
        toRaw(this),
      )
    }
    return type === TriggerOpTypes.DELETE
      ? false
      : type === TriggerOpTypes.CLEAR
        ? undefined
        : this
  }
}

type Instrumentations = Record<string | symbol, Function | number>

// 为集合类型封装额外的逻辑操作
function createInstrumentations(
  readonly: boolean,
  shallow: boolean,
): Instrumentations {
  const instrumentations: Instrumentations = {
    get(this: MapTypes, key: unknown) {
      // #1772: readonly(reactive(Map)) should return readonly + reactive version
      // of the value
      const target = this[ReactiveFlags.RAW]
      const rawTarget = toRaw(target)
      const rawKey = toRaw(key)
      if (!readonly) {
        if (hasChanged(key, rawKey)) {
          track(rawTarget, TrackOpTypes.GET, key)
        }
        track(rawTarget, TrackOpTypes.GET, rawKey)
      }
      const { has } = getProto(rawTarget)
      const wrap = shallow ? toShallow : readonly ? toReadonly : toReactive
      if (has.call(rawTarget, key)) {
        return wrap(target.get(key))
      } else if (has.call(rawTarget, rawKey)) {
        return wrap(target.get(rawKey))
      } else if (target !== rawTarget) {
        // #3602 readonly(reactive(Map))
        // ensure that the nested reactive `Map` can do tracking for itself
        target.get(key)
      }
    },
    get size() {
      const target = (this as unknown as IterableCollections)[ReactiveFlags.RAW]
      !readonly && track(toRaw(target), TrackOpTypes.ITERATE, ITERATE_KEY)
      return target.size
    },
    has(this: CollectionTypes, key: unknown): boolean {
      const target = this[ReactiveFlags.RAW]
      const rawTarget = toRaw(target)
      const rawKey = toRaw(key)
      if (!readonly) {
        if (hasChanged(key, rawKey)) {
          track(rawTarget, TrackOpTypes.HAS, key)
        }
        track(rawTarget, TrackOpTypes.HAS, rawKey)
      }
      return key === rawKey
        ? target.has(key)
        : target.has(key) || target.has(rawKey)
    },
    forEach(this: IterableCollections, callback: Function, thisArg?: unknown) {
      const observed = this
      const target = observed[ReactiveFlags.RAW]
      const rawTarget = toRaw(target)
      const wrap = shallow ? toShallow : readonly ? toReadonly : toReactive
      !readonly && track(rawTarget, TrackOpTypes.ITERATE, ITERATE_KEY)
      return target.forEach((value: unknown, key: unknown) => {
        // important: make sure the callback is
        // 1. invoked with the reactive map as `this` and 3rd arg
        // 2. the value received should be a corresponding reactive/readonly.
        return callback.call(thisArg, wrap(value), wrap(key), observed)
      })
    },
  }

  extend(
    instrumentations,
    readonly
      ? {
          add: createReadonlyMethod(TriggerOpTypes.ADD),
          set: createReadonlyMethod(TriggerOpTypes.SET),
          delete: createReadonlyMethod(TriggerOpTypes.DELETE),
          clear: createReadonlyMethod(TriggerOpTypes.CLEAR),
        }
      : {
          add(this: SetTypes, value: unknown) {
            if (!shallow && !isShallow(value) && !isReadonly(value)) {
              value = toRaw(value)
            }
            const target = toRaw(this)
            const proto = getProto(target)
            const hadKey = proto.has.call(target, value)
            if (!hadKey) {
              target.add(value)
              trigger(target, TriggerOpTypes.ADD, value, value)
            }
            return this
          },
          set(this: MapTypes, key: unknown, value: unknown) {
            if (!shallow && !isShallow(value) && !isReadonly(value)) {
              value = toRaw(value)
            }
            const target = toRaw(this)
            const { has, get } = getProto(target)

            let hadKey = has.call(target, key)
            if (!hadKey) {
              key = toRaw(key)
              hadKey = has.call(target, key)
            } else if (__DEV__) {
              checkIdentityKeys(target, has, key)
            }

            const oldValue = get.call(target, key)
            target.set(key, value)
            if (!hadKey) {
              trigger(target, TriggerOpTypes.ADD, key, value)
            } else if (hasChanged(value, oldValue)) {
              trigger(target, TriggerOpTypes.SET, key, value, oldValue)
            }
            return this
          },
          delete(this: CollectionTypes, key: unknown) {
            const target = toRaw(this)
            const { has, get } = getProto(target)
            let hadKey = has.call(target, key)
            if (!hadKey) {
              key = toRaw(key)
              hadKey = has.call(target, key)
            } else if (__DEV__) {
              checkIdentityKeys(target, has, key)
            }

            const oldValue = get ? get.call(target, key) : undefined
            // forward the operation before queueing reactions
            const result = target.delete(key)
            if (hadKey) {
              trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
            }
            return result
          },
          clear(this: IterableCollections) {
            const target = toRaw(this)
            const hadItems = target.size !== 0
            const oldTarget = __DEV__
              ? isMap(target)
                ? new Map(target)
                : new Set(target)
              : undefined
            // forward the operation before queueing reactions
            const result = target.clear()
            if (hadItems) {
              trigger(
                target,
                TriggerOpTypes.CLEAR,
                undefined,
                undefined,
                oldTarget,
              )
            }
            return result
          },
        },
  )

  const iteratorMethods = [
    'keys',
    'values',
    'entries',
    Symbol.iterator,
  ] as const

  iteratorMethods.forEach(method => {
    instrumentations[method] = createIterableMethod(method, readonly, shallow)
  })

  return instrumentations
}

function createInstrumentationGetter(isReadonly: boolean, shallow: boolean) {
  const instrumentations = createInstrumentations(isReadonly, shallow)

  return (
    target: CollectionTypes,
    key: string | symbol,
    receiver: CollectionTypes,
  ) => {
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly
    } else if (key === ReactiveFlags.RAW) {
      return target
    }

    return Reflect.get(
      hasOwn(instrumentations, key) && key in target
        ? instrumentations
        : target,
      key,
      receiver,
    )
  }
}

export const mutableCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: /*@__PURE__*/ createInstrumentationGetter(false, false),
}

export const shallowCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: /*@__PURE__*/ createInstrumentationGetter(false, true),
}

export const readonlyCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: /*@__PURE__*/ createInstrumentationGetter(true, false),
}

export const shallowReadonlyCollectionHandlers: ProxyHandler<CollectionTypes> =
  {
    get: /*@__PURE__*/ createInstrumentationGetter(true, true),
  }

function checkIdentityKeys(
  target: CollectionTypes,
  has: (key: unknown) => boolean,
  key: unknown,
) {
  const rawKey = toRaw(key)
  if (rawKey !== key && has.call(target, rawKey)) {
    const type = toRawType(target)
    warn(
      `Reactive ${type} contains both the raw and reactive ` +
        `versions of the same object${type === `Map` ? ` as keys` : ``}, ` +
        `which can lead to inconsistencies. ` +
        `Avoid differentiating between the raw and reactive versions ` +
        `of an object and only use the reactive version if possible.`,
    )
  }
}
