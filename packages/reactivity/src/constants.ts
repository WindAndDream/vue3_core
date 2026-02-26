// using literal strings instead of numbers so that it's easier to inspect
// debugger events
/**
 * 收集阶段（Track）：

   副作用函数执行时访问响应式对象
   Proxy拦截访问操作，调用track函数
   建立"属性→副作用函数"的映射关系
 
   触发阶段（Trigger）：
 
   响应式对象发生变更
   Proxy拦截变更操作，调用trigger函数
   根据变更类型找到相关依赖并重新执行
 */
/**
 * 依赖收集 = 响应式属性收集"依赖它的副作用函数"
 * 目的是建立"数据→函数"的通知关系，当数据变化时知道要执行哪些函数
 */

export enum TrackOpTypes {
  GET = 'get',
  HAS = 'has',
  ITERATE = 'iterate',
}

/** 赋值、增加、删除、清除 */
export enum TriggerOpTypes {
  SET = 'set',
  ADD = 'add',
  DELETE = 'delete',
  CLEAR = 'clear',
}

/** 响应式对象标志 */
export enum ReactiveFlags {
  SKIP = '__v_skip',
  IS_REACTIVE = '__v_isReactive',
  IS_READONLY = '__v_isReadonly',
  IS_SHALLOW = '__v_isShallow',
  RAW = '__v_raw', // 通过这个标志可以获取代理对象后的原始对象
  IS_REF = '__v_isRef',
}
