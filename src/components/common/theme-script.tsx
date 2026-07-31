/**
 * 注入到 <head>，在 React 加载前同步应用主题，避免首屏闪烁。
 * 必须保留为纯文本，匹配 .dark 选择器。
 */
export function ThemeScript() {
  const code = `
(function() {
  try {
    var key = 'paiw-theme';
    var stored = localStorage.getItem(key);
    var mode = (stored === 'light' || stored === 'dark' || stored === 'system') ? stored : 'system';
    var dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {}
})();
`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
