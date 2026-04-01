/**
 * 用于依赖和副作用之间构建连接的追踪类型
 * 当响应式数据触发了get、has、iterate（获取、拥有、迭代）时
 * 会将依赖和副作用之间进行 link，可以理解为哪些操作会进行追踪依赖，构建关系
 */
export enum TrackOpTypes {
  GET = 'get',
  HAS = 'has',
  ITERATE = 'iterate',
}

/**
 * 用于重新触发副作用的触发类型
 * 当响应式触发了set、add、delete、clear（设置、增加、删除、清除）时
 * 副作用函数会重新执行，以便同步最新的数据
 */
export enum TriggerOpTypes {
  SET = 'set',
  ADD = 'add',
  DELETE = 'delete',
  CLEAR = 'clear',
}

/**
 * 响应式对象标志
 * 当我们通过这些标志的值作为 key 去 get 响应式对象时，则会拿到对应标志的值
 * 如传入 RAW，则获得响应式对象的原始值，其他以此类推
 */
export enum ReactiveFlags {
  SKIP = '__v_skip',
  IS_REACTIVE = '__v_isReactive',
  IS_READONLY = '__v_isReadonly',
  IS_SHALLOW = '__v_isShallow',
  RAW = '__v_raw', // 通过这个标志可以获取代理对象的原始对象
  IS_REF = '__v_isRef',
}
