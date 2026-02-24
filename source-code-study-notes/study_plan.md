# Vue 3 源码阅读指南

欢迎来到 Vue 3 的代码仓库！作为一个新人，面对 Monorepo（单体仓库）结构可能会感到无从下手。这份指南将为你提供一条清晰的源码阅读路径，帮助你由浅入深地理解 Vue 3 的运作机制。

## 📂 项目结构概览

Vue 3 使用 pnpm 管理 Monorepo，核心代码都位于 `packages/` 目录下：

- **reactivity**: 独立的响应式系统（可以脱离 Vue 单独使用）。
- **runtime-core**: 平台无关的运行时（虚拟 DOM、组件系统等）。
- **runtime-dom**: 针对浏览器的运行时（DOM 操作、属性处理）。
- **compiler-core**: 平台无关的模板编译器。
- **compiler-dom**: 针对浏览器的编译器扩展。
- **vue**: “入口包”，整合了以上模块并导出 Vue 的所有功能。

## 🚀 推荐阅读路径

### 第一阶段：响应式系统 (Reactivity - 核心灵魂)
*原因*：这是 Vue 最独特的“魔法”，且相对独立，不涉及复杂的 UI 逻辑。
*位置*：`packages/reactivity/src`

1.  **`effect.ts`**：系统的核心的心脏。重点理解 `effect`（副作用）、`track`（依赖收集）和 `trigger`（派发更新）。
2.  **`reactive.ts`**：如何使用 ES6 `Proxy` 来拦截对象操作。
3.  **`ref.ts`**：基本类型（Primitive values）如何实现响应式。
4.  **`computed.ts`**：计算属性是如何基于 `effect` 实现的。

### 第二阶段：核心运行时 (Runtime Core - 引擎)
*原因*：这里是“组件”和“虚拟 DOM”存在的地方。
*位置*：`packages/runtime-core/src`

1.  **`renderer.ts`**：巨大的 `baseCreateRenderer` 函数。这里包含了 `patch` 循环（Diff 算法）和挂载逻辑。
    - 重点关注：`patch`, `mountElement`, `mountComponent`, `processElement`。
2.  **`component.ts`**：组件是如何被实例化、状态是如何管理的。
    - 重点关注：`createComponentInstance`, `setupComponent`。
3.  **`h.ts`**：`h` 函数，用于手动创建虚拟节点 (VNode)。
4.  **`scheduler.ts`**：Vue 如何使用 `queueJob` 批量处理更新（这是更新异步的原因）。
5.  **`apiCreateApp.ts`**：当你调用 `createApp()` 时发生了什么。

### 第三阶段：DOM 运行时 (Runtime DOM - 连接器)
*原因*：看看核心逻辑是如何对接真实浏览器的。
*位置*：`packages/runtime-dom/src`

1.  **`index.ts`**：`runtime-dom` 如何配置 `runtime-core` 的节点操作。
2.  **`nodeOps.ts`**：对 `document.createElement`、`appendChild` 等原生 API 的封装。
3.  **`patchProp.ts`**：如何处理 class、style、事件监听和 DOM 属性。

### 第四阶段：编译器 (Compiler - 变形金刚)
*原因*：理解模板字符串 (`<template>`) 是如何变成 JavaScript 代码的。
*位置*：`packages/compiler-core/src`

1.  **`parse.ts`**：将模板字符串解析为 AST（抽象语法树）。
2.  **`transform.ts`**：操作 AST（处理 `v-if`、`v-for` 等指令）。
3.  **`codegen.ts`**：生成最终的 `render` 函数代码字符串。

## 🛠 调试与学习技巧
1.  **单元测试是最好的老师**：查看 `packages/reactivity/__tests__` 等目录下的测试用例，它们是功能最精简的 demo。
2.  **Source Maps**：在开发模式下运行 Vue 应用时，可以直接在 Chrome DevTools 中找到这些文件并打断点。
3.  **最小化复现**：尝试只引入 `@vue/reactivity` 编写一个没有 UI 的纯 JS 脚本，来验证你对响应式原理的理解。

## 🏁 你当前的位置
你现在正在看 `packages/reactivity/src/effect.ts`，这是一个极好的起点！请继续专注于理解 `track`（收集依赖）和 `trigger`（触发更新）是如何配合工作的。
