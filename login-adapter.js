/**
 * 宿主项目的接入点，完整契约及示例见 doc/登录页接入指南.md。
 * authenticate(token, { signal })：返回 { authenticated: true, ...业务数据 }
 * 或 { authenticated: false }；网络/服务异常应抛出异常，不计入密钥错误次数。
 * onAuthenticated(result)：在刻印点亮及退场完成后处理导航或卸载登录页。
 * 未配置认证时不放行；未配置完成回调时停留在完整点亮状态。
 */
export const loginAdapter = {
  authenticate: null,
  onAuthenticated: null,
};
