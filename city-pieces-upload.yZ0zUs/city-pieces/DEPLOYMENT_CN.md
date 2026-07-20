# City Pieces 双平台部署

本项目可从同一个 GitHub 仓库同时部署到 Vercel 和腾讯 EdgeOne Pages。

## 两个平台都要设置的环境变量

- `NEXT_PUBLIC_AMAP_KEY`：高德地图 Web 端 Key
- `NEXT_PUBLIC_AMAP_SECURITY_CODE`：高德地图 `securityJsCode`

环境变量会在构建时写入浏览器端代码。不要把实际值提交到 GitHub。

## EdgeOne Pages

1. 打开 EdgeOne Pages 控制台并登录。
2. 点击“创建项目”，选择“导入 Git 仓库”。
3. 授权 GitHub，并选择 City Pieces 所在仓库。
4. 生产分支选择 `main`，项目根目录保持仓库根目录。
5. 项目会读取根目录的 `edgeone.json`：安装命令为 `npm ci`，构建命令为 `npm run build:edgeone`，输出目录为 `out`，Node.js 为 `22.11.0`。
6. 展开“环境变量”，分别添加上面的两个变量。
7. 点击“开始部署”。部署完成后，点击系统生成的 HTTPS 地址检查地图。
8. 在高德开放平台对应的 Web 端 Key 中，把 EdgeOne 默认域名和之后绑定的自定义域名加入安全域名白名单。

## Vercel

1. 打开 Vercel 控制台并登录。
2. 点击“Add New”→“Project”，选择同一个 GitHub 仓库。
3. Framework Preset 选择 Next.js，Root Directory 保持仓库根目录。
4. 构建命令会从根目录的 `vercel.json` 自动读取为 `npm run build:vercel`，通常不需要手动修改。
5. 在“Environment Variables”添加上面的两个变量。
6. 点击“Deploy”。如果现有 Vercel 项目已经连接此仓库，无需重新创建。
7. 在高德开放平台把 Vercel 正式域名加入同一 Web 端 Key 的安全域名白名单。

以后向 GitHub 的 `main` 分支提交代码，两个平台都可以各自自动构建和发布。
