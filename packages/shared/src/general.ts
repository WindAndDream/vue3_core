import { makeMap } from './makeMap'

/**
 * 作用：全局的空对象，表示“一个不会被修改的空对象”。
   在开发环境下（__DEV__ === true），通过 Object.freeze 冻结，避免被意外修改，利于调试。
   在生产环境下就直接用普通的 {}，省掉 freeze 带来的性能消耗。

   使用场景：
   很多 Vue 内部函数如果参数没传，就会用这个对象作为默认值，避免每次调用都新建一个 {}。
 */
export const EMPTY_OBJ: { readonly [key: string]: any } = __DEV__
  ? Object.freeze({})
  : {}

/**
 * 作用：全局的空数组。
   和 EMPTY_OBJ 一样，开发环境下会冻结，生产环境下就是普通空数组。
   readonly never[] 类型说明它是一个只读数组（不能改），里面不会有元素。

   使用场景：
   比如某些地方需要默认返回一个数组时，用它作为 稳定的空数组引用。
  */
export const EMPTY_ARR: readonly never[] = __DEV__ ? Object.freeze([]) : []

/**
 * 作用：空函数，不做任何事。
   名字来源于 No Operation。

   使用场景：
   如果某个地方需要传一个函数，但实际上什么都不需要做，就用 NOOP。
   例如事件处理的默认回调。
 */
export const NOOP = (): void => {}

/**
 * 作用：始终返回 false 的函数。
 * 
   使用场景：
   某些配置项或者函数默认需要返回布尔值，可以直接用 NO。

   例如：
   判断某个特性是否开启（默认关闭）。
   Vue 内部对某些特性进行条件判断时，默认就用 NO 来禁用。
 */
export const NO = () => false

/**
 * 
   功能：判断一个字符串是不是 Vue 事件监听函数的 key。
   Vue 内部事件的命名规则是 onXxx（比如 onClick, onInput 等）。
   isOn 就是检测字符串是否以 "on" 开头，并且 第三个字符是大写字母。

   为什么要这样写？
   1. 性能优化
   直接用 charCodeAt 对比数值，比字符串操作（如 startsWith("on")）更快，适合在框架源码里被频繁调用。
   
   2. 保证和 DOM 事件规范一致
   DOM 事件属性名都是 onXxx（X 要大写），比如 onclick 是 HTML 属性，而 Vue 用的是 onClick。
   Vue 内部需要区分普通 props 和事件监听器，所以通过这个函数快速判断。

 * @param key 事件监听函数的key
 * @returns 布尔值，是否为事件监听函数的key
 */
export const isOn = (key: string): boolean =>
  key.charCodeAt(0) === 111 /* o */ &&
  key.charCodeAt(1) === 110 /* n */ &&
  // uppercase letter
  (key.charCodeAt(2) > 122 || key.charCodeAt(2) < 97)

/**
 * 判断某个字符串是不是 v-model 相关的事件监听器。
 * @param key v-model 的监听器
 * @returns 布尔值，是否为 v-model 的监听器
 */
export const isModelListener = (key: string): key is `onUpdate:${string}` =>
  key.startsWith('onUpdate:')

export const extend: typeof Object.assign = Object.assign

export const remove = <T>(arr: T[], el: T): void => {
  const i = arr.indexOf(el)
  if (i > -1) {
    arr.splice(i, 1)
  }
}

const hasOwnProperty = Object.prototype.hasOwnProperty
export const hasOwn = (
  val: object,
  key: string | symbol,
): key is keyof typeof val => hasOwnProperty.call(val, key)

export const isArray: typeof Array.isArray = Array.isArray
export const isMap = (val: unknown): val is Map<any, any> =>
  toTypeString(val) === '[object Map]'
export const isSet = (val: unknown): val is Set<any> =>
  toTypeString(val) === '[object Set]'

export const isDate = (val: unknown): val is Date =>
  toTypeString(val) === '[object Date]'
export const isRegExp = (val: unknown): val is RegExp =>
  toTypeString(val) === '[object RegExp]'
export const isFunction = (val: unknown): val is Function =>
  typeof val === 'function'
export const isString = (val: unknown): val is string => typeof val === 'string'
export const isSymbol = (val: unknown): val is symbol => typeof val === 'symbol'
export const isObject = (val: unknown): val is Record<any, any> =>
  val !== null && typeof val === 'object'

export const isPromise = <T = any>(val: unknown): val is Promise<T> => {
  return (
    (isObject(val) || isFunction(val)) &&
    isFunction((val as any).then) &&
    isFunction((val as any).catch)
  )
}

export const objectToString: typeof Object.prototype.toString =
  Object.prototype.toString
export const toTypeString = (value: unknown): string =>
  objectToString.call(value)

export const toRawType = (value: unknown): string => {
  // extract "RawType" from strings like "[object RawType]"
  return toTypeString(value).slice(8, -1)
}

export const isPlainObject = (val: unknown): val is object =>
  toTypeString(val) === '[object Object]'

export const isIntegerKey = (key: unknown): boolean =>
  isString(key) &&
  key !== 'NaN' &&
  key[0] !== '-' &&
  '' + parseInt(key, 10) === key

export const isReservedProp: (key: string) => boolean = /*@__PURE__*/ makeMap(
  // the leading comma is intentional so empty string "" is also included
  ',key,ref,ref_for,ref_key,' +
    'onVnodeBeforeMount,onVnodeMounted,' +
    'onVnodeBeforeUpdate,onVnodeUpdated,' +
    'onVnodeBeforeUnmount,onVnodeUnmounted',
)

export const isBuiltInDirective: (key: string) => boolean =
  /*@__PURE__*/ makeMap(
    'bind,cloak,else-if,else,for,html,if,model,on,once,pre,show,slot,text,memo',
  )

const cacheStringFunction = <T extends (str: string) => string>(fn: T): T => {
  const cache: Record<string, string> = Object.create(null)
  return ((str: string) => {
    const hit = cache[str]
    return hit || (cache[str] = fn(str))
  }) as T
}

const camelizeRE = /-(\w)/g
/**
 * @private
 */
export const camelize: (str: string) => string = cacheStringFunction(
  (str: string): string => {
    return str.replace(camelizeRE, (_, c) => (c ? c.toUpperCase() : ''))
  },
)

const hyphenateRE = /\B([A-Z])/g
/**
 * @private
 */
export const hyphenate: (str: string) => string = cacheStringFunction(
  (str: string) => str.replace(hyphenateRE, '-$1').toLowerCase(),
)

/**
 * @private
 */
export const capitalize: <T extends string>(str: T) => Capitalize<T> =
  cacheStringFunction(<T extends string>(str: T) => {
    return (str.charAt(0).toUpperCase() + str.slice(1)) as Capitalize<T>
  })

/**
 * @private
 */
export const toHandlerKey: <T extends string>(
  str: T,
) => T extends '' ? '' : `on${Capitalize<T>}` = cacheStringFunction(
  <T extends string>(str: T) => {
    const s = str ? `on${capitalize(str)}` : ``
    return s as T extends '' ? '' : `on${Capitalize<T>}`
  },
)

// compare whether a value has changed, accounting for NaN.
export const hasChanged = (value: any, oldValue: any): boolean =>
  !Object.is(value, oldValue)

export const invokeArrayFns = (fns: Function[], ...arg: any[]): void => {
  for (let i = 0; i < fns.length; i++) {
    fns[i](...arg)
  }
}

export const def = (
  obj: object,
  key: string | symbol,
  value: any,
  writable = false,
): void => {
  Object.defineProperty(obj, key, {
    configurable: true,
    enumerable: false,
    writable,
    value,
  })
}

/**
 * "123-foo" will be parsed to 123
 * This is used for the .number modifier in v-model
 */
export const looseToNumber = (val: any): any => {
  const n = parseFloat(val)
  return isNaN(n) ? val : n
}

/**
 * Only concerns number-like strings
 * "123-foo" will be returned as-is
 */
export const toNumber = (val: any): any => {
  const n = isString(val) ? Number(val) : NaN
  return isNaN(n) ? val : n
}

// for typeof global checks without @types/node
declare var global: {}

let _globalThis: any
export const getGlobalThis = (): any => {
  return (
    _globalThis ||
    (_globalThis =
      typeof globalThis !== 'undefined'
        ? globalThis
        : typeof self !== 'undefined'
          ? self
          : typeof window !== 'undefined'
            ? window
            : typeof global !== 'undefined'
              ? global
              : {})
  )
}

const identRE = /^[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*$/

export function genPropsAccessExp(name: string): string {
  return identRE.test(name)
    ? `__props.${name}`
    : `__props[${JSON.stringify(name)}]`
}

export function genCacheKey(source: string, options: any): string {
  return (
    source +
    JSON.stringify(options, (_, val) =>
      typeof val === 'function' ? val.toString() : val,
    )
  )
}
