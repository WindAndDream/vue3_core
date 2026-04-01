import {
  type Target,
  isReadonly,
  isShallow,
  reactive,
  reactiveMap,
  readonly,
  readonlyMap,
  shallowReactiveMap,
  shallowReadonlyMap,
  toRaw,
} from './reactive'
import { arrayInstrumentations } from './arrayInstrumentations'
import { ReactiveFlags, TrackOpTypes, TriggerOpTypes } from './constants'
import { ITERATE_KEY, track, trigger } from './dep'
import {
  hasChanged,
  hasOwn,
  isArray,
  isIntegerKey,
  isObject,
  isSymbol,
  makeMap,
} from '@vue/shared'
import { isRef } from './ref'
import { warn } from './warning'

const isNonTrackableKeys = /*@__PURE__*/ makeMap(`__proto__,__v_isRef,__isVue`)

// 取出 Symbol 构造函数自身的静态属性名
const builtInSymbols = new Set(
  /*@__PURE__*/
  Object.getOwnPropertyNames(Symbol)
    // 兼容老的 iOS 10.x那里枚举 Symbol 时可能会出现 arguments、caller，访问它们会报错，所以先排掉
    .filter(key => key !== 'arguments' && key !== 'caller')
    .map(key => Symbol[key as keyof SymbolConstructor]) // 把属性名映射成真正的值
    .filter(isSymbol), // 只保留“值本身是 symbol”的那些成员
)

// 用于拦截 hasOwnProperty 方法
function hasOwnProperty(this: object, key: unknown) {
  // #10455 hasOwnProperty may be called with non-string values
  if (!isSymbol(key)) key = String(key) // 把 key 规范化成字符串或 symbol
  const obj = toRaw(this) // 拿到原始对象
  track(obj, TrackOpTypes.HAS, key)
  return obj.hasOwnProperty(key as string) // 调用原始对象的 hasOwnProperty
}

// 所有代理处理器的基类
class BaseReactiveHandler implements ProxyHandler<Target> {
  constructor(
    protected readonly _isReadonly = false, // 是否只读
    protected readonly _isShallow = false, // 深/浅层代理
  ) {}

  // 触发 get 方法时的钩子
  // target 为代理的原始对象，key 则是触发 get 的键
  // receiver 非常特殊，由于JS中的 this 是动态，这个参数指的是本次属性访问的接收者，作为 getter/Reflect.get 的 this 绑定来源
  // receiver 不一定就是当前这个代理本身，也可能是继承链上的对象或外层用户 Proxy
  get(target: Target, key: string | symbol, receiver: object): any {
    // 如果访问的key为响应式标志，则直接对应的值
    if (key === ReactiveFlags.SKIP) return target[ReactiveFlags.SKIP]

    // 只读、深/浅层
    const isReadonly = this._isReadonly,
      isShallow = this._isShallow

    // 访问的key为响应式标志
    if (key === ReactiveFlags.IS_REACTIVE) {
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      return isReadonly
    } else if (key === ReactiveFlags.IS_SHALLOW) {
      return isShallow
    }
    // 通过 RAW 位标记获取原始对象
    else if (key === ReactiveFlags.RAW) {
      // 要求 receiver 要么就是 Vue 缓存里的那个代理本体，要么和 target 有同样的原型
      // 这样 toRaw() 才能拿到原对象，同时也兼容“用户又包了一层 Proxy”的场景
      if (
        receiver ===
          (isReadonly
            ? isShallow
              ? shallowReadonlyMap
              : readonlyMap
            : isShallow
              ? shallowReactiveMap
              : reactiveMap
          ).get(target) ||
        // 兼容性放行条件，主要是为了支持“用户再包一层 Proxy”这种场景
        // 只要原型相同，也就当作“对应的代理对象”，直接放行
        Object.getPrototypeOf(target) === Object.getPrototypeOf(receiver)
      ) {
        return target
      }
      // early return undefined
      return
    }

    const targetIsArray = isArray(target)

    // 目标是数组且不是只读
    if (!isReadonly) {
      let fn: Function | undefined
      // 走数组方法增强版 arrayInstrumentations，为了解决数组查找、长度变更、迭代追踪、ref 元素处理等问题
      if (targetIsArray && (fn = arrayInstrumentations[key])) {
        return fn
      }

      if (key === 'hasOwnProperty') {
        return hasOwnProperty
      }
    }

    // get 的结果
    const res = Reflect.get(
      target,
      key,
      // if this is a proxy wrapping a ref, return methods using the raw ref
      // as receiver so that we don't have to call `toRaw` on the ref in all
      // its class methods
      isRef(target) ? target : receiver,
    )

    // 内建 symbol 和 __proto__ / __v_isRef / __isVue 这些 key 直接返回，不 track
    if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
      return res
    }

    // 可变代理读取属性时才建立依赖；只读代理不做依赖收集
    if (!isReadonly) {
      track(target, TrackOpTypes.GET, key)
    }

    // 如果是浅层代理，直接返回
    // 浅层代理“只追踪这一层的 key 访问”，但不会继续做 ref 解包，也不会把嵌套对象再转成 reactive/readonly
    if (isShallow) {
      return res
    }

    // 深层代理 ref 解包
    if (isRef(res)) {
      // 普通对象属性会返回 res.value
      // 但数组的整数索引不会解包，arr[0] 读到 ref 仍然返回 ref 本身这是为了避免数组语义混乱
      const value = targetIsArray && isIntegerKey(key) ? res : res.value
      return isReadonly && isObject(value) ? readonly(value) : value
    }

    // 如果读出来的是对象，就懒代理，不会立刻深递归遍历，而是返回 reactive(res) 或 readonly(res)
    // 后面你再访问这个嵌套对象的属性时，才会再次进入新的 get 流程
    if (isObject(res)) {
      return isReadonly ? readonly(res) : reactive(res)
    }

    return res
  }
}

// 可变处理器的实现
class MutableReactiveHandler extends BaseReactiveHandler {
  constructor(isShallow = false) {
    super(false, isShallow)
  }

  // set 钩子
  set(
    target: Record<string | symbol, unknown>,
    key: string | symbol,
    value: unknown,
    receiver: object,
  ): boolean {
    let oldValue = target[key]
    // 是否为数组的字符串索引
    const isArrayWithIntegerKey = isArray(target) && isIntegerKey(key)
    // 非浅层
    if (!this._isShallow) {
      const isOldValueReadonly = isReadonly(oldValue)
      // 非浅层、并且非只读
      if (!isShallow(value) && !isReadonly(value)) {
        oldValue = toRaw(oldValue)
        value = toRaw(value)
      }
      if (!isArrayWithIntegerKey && isRef(oldValue) && !isRef(value)) {
        if (isOldValueReadonly) {
          if (__DEV__) {
            warn(
              `Set operation on key "${String(key)}" failed: target is readonly.`,
              target[key],
            )
          }
          return true
        } else {
          oldValue.value = value
          return true
        }
      }
    } else {
      // in shallow mode, objects are set as-is regardless of reactive or not
    }

    // 用于判断是在改已有 key，还是在新增 key
    const hadKey = isArrayWithIntegerKey
      ? Number(key) < target.length
      : hasOwn(target, key)
    // 给对象设置赋值，返回的结果为“是否赋值成功”
    const result = Reflect.set(
      target,
      key,
      value,
      isRef(target) ? target : receiver,
    )

    /**
     * const parent = reactive({ foo: 1 })
     * const child = reactive({})
     * Object.setPrototypeOf(child, parent)
     * child.foo = 2
     *
     * 这里真正变化的是 child.foo，不是 parent.foo所以只应该触发 child 的更新，不应该让 parent 那层也 trigger
     */
    // 若目标位于原始对象的原生原型链中，则不触发
    // 简单来说，当子对象中没有某个属性时，则会顺着原型链往上查找，但这个时候已经不是我们要赋值的对象了
    if (target === toRaw(receiver)) {
      if (!hadKey) {
        // 新增属性 / 新增数组元素
        trigger(target, TriggerOpTypes.ADD, key, value)
      } else if (hasChanged(value, oldValue)) {
        // 普通修改
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
      }
    }
    return result
  }

  deleteProperty(
    target: Record<string | symbol, unknown>,
    key: string | symbol,
  ): boolean {
    const hadKey = hasOwn(target, key)
    const oldValue = target[key]
    const result = Reflect.deleteProperty(target, key)
    if (result && hadKey) {
      trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
    }
    return result
  }

  has(target: Record<string | symbol, unknown>, key: string | symbol): boolean {
    const result = Reflect.has(target, key)
    if (!isSymbol(key) || !builtInSymbols.has(key)) {
      track(target, TrackOpTypes.HAS, key)
    }
    return result
  }

  ownKeys(target: Record<string | symbol, unknown>): (string | symbol)[] {
    track(
      target,
      TrackOpTypes.ITERATE,
      isArray(target) ? 'length' : ITERATE_KEY,
    )
    return Reflect.ownKeys(target)
  }
}

class ReadonlyReactiveHandler extends BaseReactiveHandler {
  constructor(isShallow = false) {
    super(true, isShallow)
  }

  set(target: object, key: string | symbol) {
    if (__DEV__) {
      warn(
        `Set operation on key "${String(key)}" failed: target is readonly.`,
        target,
      )
    }
    return true
  }

  deleteProperty(target: object, key: string | symbol) {
    if (__DEV__) {
      warn(
        `Delete operation on key "${String(key)}" failed: target is readonly.`,
        target,
      )
    }
    return true
  }
}

/** 用于创建响应式对象时的使用 */

// 可变处理器
export const mutableHandlers: ProxyHandler<object> =
  /*@__PURE__*/ new MutableReactiveHandler()

// 只读处理器
export const readonlyHandlers: ProxyHandler<object> =
  /*@__PURE__*/ new ReadonlyReactiveHandler()

// 浅层可变处理器
export const shallowReactiveHandlers: MutableReactiveHandler =
  /*@__PURE__*/ new MutableReactiveHandler(true)

// Props handlers are special in the sense that it should not unwrap top-level
// refs (in order to allow refs to be explicitly passed down), but should
// retain the reactivity of the normal readonly object.
// 浅层只读处理器
export const shallowReadonlyHandlers: ReadonlyReactiveHandler =
  /*@__PURE__*/ new ReadonlyReactiveHandler(true)
