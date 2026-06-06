# 炸金花

一个轻量的多人炸金花网页游戏，适合部署到 NAS、VPS、家用服务器或容器平台。玩家用浏览器访问即可加入，支持手机端，适合通过公网域名、反向代理、内网穿透或局域网访问。

> 本项目仅用于朋友间娱乐和学习交流，不包含真钱结算、支付、账号系统或赌博功能。

## 功能

- 浏览器直接游玩，无需安装 App
- 房间号加入，可复制邀请链接
- 创建房间时可设置房间密码
- 创建房间时可设置人数上限，部署级最大人数默认 `17`
- 实时同步牌局状态
- 看牌、闷跟、明跟、加注、比牌、弃牌
- 自动洗牌、发牌、判型、结算、下一局
- 手机端适配

## 快速开始

```bash
node server.js
```

打开：

```text
http://localhost:3000
```

## Docker Compose 部署

如果在服务器上直接构建镜像：

```bash
docker compose up -d --build
```

然后访问：

```text
http://服务器IP:3000
```

如果已经配置了域名和反向代理，可以通过你的域名访问。

## Dockge 拉取镜像部署

如果你希望 Dockge 直接拉取镜像，而不是在服务器上构建镜像，可以使用 GitHub Container Registry。

本仓库推送到 GitHub 的 `main` 分支后，GitHub Actions 会自动构建并发布镜像：

```text
ghcr.io/你的GitHub用户名/你的仓库名:latest
```

第一次发布后，在 GitHub 仓库或个人主页的 `Packages` 中打开镜像包，把可见性设置为 `Public`。如果镜像保持私有，需要先在服务器上登录 GHCR。

Dockge 新建 Stack 后粘贴：

```yaml
services:
  zha-jin-hua:
    image: ghcr.io/YOUR_GITHUB_USERNAME/YOUR_REPOSITORY_NAME:latest
    container_name: zha-jin-hua
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      PORT: 3000
      STARTING_CHIPS: 1000
      ANTE: 10
      MAX_PLAYERS: 17
      MAX_FAILED_JOINS: 20
```

把 `YOUR_GITHUB_USERNAME` 和 `YOUR_REPOSITORY_NAME` 替换成实际值。

例如：

```yaml
image: ghcr.io/shenyebuwu/zhajinhua:latest
```

## 公网部署建议

可以通过这些方式对外提供访问：

- VPS 直接部署并开放端口
- Nginx Proxy Manager / Caddy / Nginx 反向代理
- Cloudflare Tunnel、FRP、ZeroTier、Tailscale Funnel 等内网穿透工具
- NAS 的反向代理或容器网关

建议：

- 公网访问时优先使用 HTTPS
- 创建房间时填写房间密码
- 不要把无密码房间长期暴露在公网
- 如果镜像或仓库是私有的，部署前需要完成对应平台的登录认证

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 容器内监听端口 |
| `STARTING_CHIPS` | `1000` | 每位玩家初始筹码 |
| `ANTE` | `10` | 底注 |
| `MAX_PLAYERS` | `17` | 部署级最大人数上限。每个房间创建时仍可选择更小的人数上限 |
| `MAX_FAILED_JOINS` | `20` | 同一来源 10 分钟内允许输错房间密码的次数 |

## 房间人数

创建房间时可以选择人数上限。服务端会用 `MAX_PLAYERS` 做部署级兜底，默认最多 `17` 人。

`17` 是 52 张牌按每人 3 张手牌计算的理论上限。实际游玩时，人数越多，手机屏幕上越拥挤，建议根据设备和玩法习惯选择合适人数。

## 当前规则

牌型大小：

```text
豹子 > 同花顺 > 同花 > 顺子 > 对子 > 单张
```

看牌后跟注和加注按双倍支付；比牌需要先看牌。

本版本暂不启用各地差异较大的特殊规则，例如 `235 吃豹子`。

## 开发

运行烟测：

```bash
node scripts/smoke-test.js
```

烟测会检查静态页面、建房、房间密码、开局、下注和基础判牌逻辑。
