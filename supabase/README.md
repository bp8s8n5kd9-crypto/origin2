# 日迹云同步初始化

1. 打开 Supabase 项目的 SQL Editor。
2. 新建查询，粘贴并运行 `schema.sql` 的全部内容。
3. 在 Authentication > URL Configuration 中，将 Site URL 设置为：
   `https://bp8s8n5kd9-crypto.github.io/origin2/`
4. 在同一页面的 Redirect URLs 中添加：
   `https://bp8s8n5kd9-crypto.github.io/origin2/`
5. 在 Authentication > Providers 中确认 Email 已启用。

`cloud-sync.js` 只包含浏览器可公开使用的 Publishable Key。不要把 Secret Key 或
Service Role Key 写入本仓库。
