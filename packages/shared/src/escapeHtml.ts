const escapeRE = /["'&<>]/ // 可能导致注入或破坏结构的字符（", ', &, <, >），需要转义。

/**
 *
 * 对动态插入 HTML 中的字符串做转义（escape），防止 XSS（跨站脚本攻击）。
 *
 * @param string 动态插入 HTML 中的字符串
 * @returns 转义/未转义的字符串
 */
export function escapeHtml(string: unknown): string {
  const str = '' + string // 不管传入什么值，都强制转为字符串
  // 判断是否需要转义，不需要则直接返回
  const match = escapeRE.exec(str)

  if (!match) {
    return str
  }

  let html = ''
  let escaped: string
  let index: number
  let lastIndex = 0
  for (index = match.index; index < str.length; index++) {
    switch (str.charCodeAt(index)) {
      case 34: // "
        escaped = '&quot;'
        break
      case 38: // &
        escaped = '&amp;'
        break
      case 39: // '
        escaped = '&#39;'
        break
      case 60: // <
        escaped = '&lt;'
        break
      case 62: // >
        escaped = '&gt;'
        break
      default:
        continue
    }

    if (lastIndex !== index) {
      html += str.slice(lastIndex, index)
    }

    lastIndex = index + 1
    html += escaped
  }

  return lastIndex !== index ? html + str.slice(lastIndex, index) : html
}

// https://www.w3.org/TR/html52/syntax.html#comments
const commentStripRE = /^-?>|<!--|-->|--!>|<!-$/g

/**
 * 函数常用于 SSR 渲染时输出注释节点，保证安全。
 
 用于 清理掉 HTML 注释中不合法或危险的标记，确保生成的注释不会破坏 HTML 结构。
 HTML 注释的语法有严格规则（见 W3C: HTML5.2 comments）。
 如果用户输入的字符串中包含 <!--, -->, <!- 等内容，可能会导致：
 提前结束注释破坏 HTML 结构，甚至插入恶意代码

 * @param src 字符串
 * @returns 已去除危险注释符号的字符串
 */
export function escapeHtmlComment(src: string): string {
  return src.replace(commentStripRE, '')
}

export const cssVarNameEscapeSymbolsRE: RegExp =
  /[ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g
/**
 * 根据 CSS 规范，自定义属性的名字必须遵循 CSS 标识符规则。
   一般允许：字母、数字、下划线 _、连字符 -。
   不允许：空格、引号、标点符号、大多数特殊字符。
 * @param key CSS变量名称
 * @param doubleEscape 是否双重转义
 * @returns 转义后的特殊字符
 */
export function getEscapedCssVarName(
  key: string,
  doubleEscape: boolean,
): string {
  return key.replace(cssVarNameEscapeSymbolsRE, s =>
    doubleEscape ? (s === '"' ? '\\\\\\"' : `\\\\${s}`) : `\\${s}`,
  )
}
