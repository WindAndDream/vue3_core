# Proxy Trap 与操作关系清单

> 目标：把 `Proxy` 的 trap 与“你实际写出来的操作”一一对应起来。

## 1. 总览表（完整 13 个 trap）

| trap | 对应内部操作 | 常见触发方式（你写的代码） |
| --- | --- | --- |
| `get` | `[[Get]]` | `proxy.foo`、`proxy['foo']`、`Reflect.get(proxy, 'foo')` |
| `set` | `[[Set]]` | `proxy.foo = v`、`proxy['foo'] = v`、`Reflect.set(proxy, 'foo', v)` |
| `has` | `[[HasProperty]]` | `'foo' in proxy`、`Reflect.has(proxy, 'foo')` |
| `deleteProperty` | `[[Delete]]` | `delete proxy.foo`、`delete proxy['foo']`、`Reflect.deleteProperty(proxy, 'foo')` |
| `defineProperty` | `[[DefineOwnProperty]]` | `Object.defineProperty(proxy, 'foo', desc)`、`Reflect.defineProperty(proxy, 'foo', desc)` |
| `getOwnPropertyDescriptor` | `[[GetOwnProperty]]` | `Object.getOwnPropertyDescriptor(proxy, 'foo')`、`Reflect.getOwnPropertyDescriptor(proxy, 'foo')` |
| `ownKeys` | `[[OwnPropertyKeys]]` | `Object.keys(proxy)`、`Object.getOwnPropertyNames(proxy)`、`Object.getOwnPropertySymbols(proxy)`、`Reflect.ownKeys(proxy)`、`for...in` |
| `getPrototypeOf` | `[[GetPrototypeOf]]` | `Object.getPrototypeOf(proxy)`、`Reflect.getPrototypeOf(proxy)` |
| `setPrototypeOf` | `[[SetPrototypeOf]]` | `Object.setPrototypeOf(proxy, proto)`、`Reflect.setPrototypeOf(proxy, proto)` |
| `isExtensible` | `[[IsExtensible]]` | `Object.isExtensible(proxy)`、`Reflect.isExtensible(proxy)` |
| `preventExtensions` | `[[PreventExtensions]]` | `Object.preventExtensions(proxy)`、`Reflect.preventExtensions(proxy)` |
| `apply` | `[[Call]]` | `proxy(...args)`、`Reflect.apply(proxy, thisArg, args)` |
| `construct` | `[[Construct]]` | `new proxy(...args)`、`Reflect.construct(proxy, args)` |

## 2. 每个 trap 的介绍与示例

### `get(target, prop, receiver)`

介绍：读取属性值时触发。

```js
const target = { foo: 1 }
const proxy = new Proxy(target, {
  get(target, prop, receiver) {
    console.log('get ->', prop)
    return Reflect.get(target, prop, receiver)
  },
})

proxy.foo
proxy['foo']
Reflect.get(proxy, 'foo')
```

### `set(target, prop, value, receiver)`

介绍：给属性赋值时触发。

```js
const target = {}
const proxy = new Proxy(target, {
  set(target, prop, value, receiver) {
    console.log('set ->', prop, value)
    return Reflect.set(target, prop, value, receiver)
  },
})

proxy.foo = 1
proxy['bar'] = 2
Reflect.set(proxy, 'baz', 3)
```

### `has(target, prop)`

介绍：用 `in` 判断属性是否存在时触发。

```js
const target = { foo: 1 }
const proxy = new Proxy(target, {
  has(target, prop) {
    console.log('has ->', prop)
    return Reflect.has(target, prop)
  },
})

'foo' in proxy
Reflect.has(proxy, 'foo')
```

### `deleteProperty(target, prop)`

介绍：删除属性时触发。

```js
const target = { foo: 1 }
const proxy = new Proxy(target, {
  deleteProperty(target, prop) {
    console.log('deleteProperty ->', prop)
    return Reflect.deleteProperty(target, prop)
  },
})

delete proxy.foo
delete proxy['foo']
Reflect.deleteProperty(proxy, 'foo')
```

### `defineProperty(target, prop, descriptor)`

介绍：定义（或重定义）自身属性时触发。

```js
const target = {}
const proxy = new Proxy(target, {
  defineProperty(target, prop, descriptor) {
    console.log('defineProperty ->', prop, descriptor)
    return Reflect.defineProperty(target, prop, descriptor)
  },
})

Object.defineProperty(proxy, 'foo', {
  value: 1,
  writable: true,
  enumerable: true,
  configurable: true,
})

Reflect.defineProperty(proxy, 'bar', {
  value: 2,
  writable: true,
  enumerable: true,
  configurable: true,
})
```

### `getOwnPropertyDescriptor(target, prop)`

介绍：读取某个自身属性描述符时触发。

```js
const target = { foo: 1 }
const proxy = new Proxy(target, {
  getOwnPropertyDescriptor(target, prop) {
    console.log('getOwnPropertyDescriptor ->', prop)
    return Reflect.getOwnPropertyDescriptor(target, prop)
  },
})

Object.getOwnPropertyDescriptor(proxy, 'foo')
Reflect.getOwnPropertyDescriptor(proxy, 'foo')
```

### `ownKeys(target)`

介绍：读取对象“自身所有键”时触发。

```js
const sym = Symbol('s')
const target = { foo: 1, bar: 2 }
target[sym] = 3

const proxy = new Proxy(target, {
  ownKeys(target) {
    console.log('ownKeys')
    return Reflect.ownKeys(target)
  },
})

Object.keys(proxy)
Object.getOwnPropertyNames(proxy)
Object.getOwnPropertySymbols(proxy)
Reflect.ownKeys(proxy)

for (const key in proxy) {
  console.log('for...in ->', key)
}
```

### `getPrototypeOf(target)`

介绍：读取原型时触发。

```js
const base = { fromBase: true }
const target = Object.create(base)

const proxy = new Proxy(target, {
  getPrototypeOf(target) {
    console.log('getPrototypeOf')
    return Reflect.getPrototypeOf(target)
  },
})

Object.getPrototypeOf(proxy)
Reflect.getPrototypeOf(proxy)
```

### `setPrototypeOf(target, proto)`

介绍：设置原型时触发。

```js
const target = {}
const nextProto = { fromProto: true }

const proxy = new Proxy(target, {
  setPrototypeOf(target, proto) {
    console.log('setPrototypeOf ->', proto)
    return Reflect.setPrototypeOf(target, proto)
  },
})

Object.setPrototypeOf(proxy, nextProto)
Reflect.setPrototypeOf(proxy, {})
```

### `isExtensible(target)`

介绍：判断对象是否可扩展时触发。

```js
const target = {}
const proxy = new Proxy(target, {
  isExtensible(target) {
    console.log('isExtensible')
    return Reflect.isExtensible(target)
  },
})

Object.isExtensible(proxy)
Reflect.isExtensible(proxy)
```

### `preventExtensions(target)`

介绍：阻止对象扩展时触发。

```js
const target = {}
const proxy = new Proxy(target, {
  preventExtensions(target) {
    console.log('preventExtensions')
    return Reflect.preventExtensions(target)
  },
})

Object.preventExtensions(proxy)
Reflect.preventExtensions(proxy)
```

### `apply(target, thisArg, argArray)`

介绍：把代理对象当函数调用时触发（目标必须是可调用函数）。

```js
function add(a, b) {
  return a + b
}

const proxy = new Proxy(add, {
  apply(target, thisArg, argArray) {
    console.log('apply ->', argArray)
    return Reflect.apply(target, thisArg, argArray)
  },
})

proxy(1, 2)
Reflect.apply(proxy, null, [3, 4])
```

### `construct(target, argArray, newTarget)`

介绍：把代理对象当构造函数 `new` 时触发（目标必须可构造）。

```js
function Person(name) {
  this.name = name
}

const proxy = new Proxy(Person, {
  construct(target, argArray, newTarget) {
    console.log('construct ->', argArray)
    return Reflect.construct(target, argArray, newTarget)
  },
})

new proxy('Alice')
Reflect.construct(proxy, ['Bob'])
```

## 3. 常见“组合触发关系”

很多操作不是只触发 1 个 trap，下面是最常见的联动关系：

1. `Object.keys(proxy)`：先 `ownKeys`，再对每个 key 取 `getOwnPropertyDescriptor`（过滤 `enumerable: true`）。
2. `for...in proxy`：通常会涉及 `ownKeys` + `getOwnPropertyDescriptor`（并沿原型链枚举）。
3. `{ ...proxy }` / `Object.assign({}, proxy)`：通常会先拿键（`ownKeys` + `getOwnPropertyDescriptor`），再逐个读值（`get`）。

```js
const target = { a: 1, b: 2 }
const proxy = new Proxy(target, {
  ownKeys(target) {
    console.log('ownKeys')
    return Reflect.ownKeys(target)
  },
  getOwnPropertyDescriptor(target, key) {
    console.log('getOwnPropertyDescriptor ->', key)
    return Reflect.getOwnPropertyDescriptor(target, key)
  },
  get(target, key, receiver) {
    console.log('get ->', key)
    return Reflect.get(target, key, receiver)
  },
})

Object.keys(proxy)
const copy1 = { ...proxy }
const copy2 = Object.assign({}, proxy)
console.log(copy1, copy2)
```

## 4. 实战建议

1. trap 内尽量使用对应的 `Reflect.xxx`，避免破坏默认语义。
2. 遇到“为什么这个操作没进某 trap”，先看它对应的是哪类内部操作（读、写、枚举、原型、可扩展性、函数调用、构造）。
3. 注意 Proxy 有不变量（invariants），比如目标不可扩展时，`ownKeys` 结果不能随便伪造。
