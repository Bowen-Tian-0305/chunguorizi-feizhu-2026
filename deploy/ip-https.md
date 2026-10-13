# 无域名的公网 IP HTTPS 部署

支持 Certbot 5.4+ 的 IP 地址证书。本配置使用 Certbot 5.8.0。IP 证书约6天有效，必须设置自动续期。证书申请需确认 Let’s Encrypt 订户协议；命令刻意保留交互确认。

官方资料：https://letsencrypt.org/2026/03/11/shorter-certs-certbot

## 部署顺序（Ubuntu / Docker）

1. 在仓库根目录准备 `.env`，权限600，服务端密钥不可写进命令日志或提交Git。
2. `python3 deploy/ip-config.py PUBLIC_IP` 创建仅提供证书验证、其他路径503的配置。
3. `docker compose -f deploy/compose-ip.yaml up -d --build`。应用只在本机127.0.0.1:4173暴露，可经SSH隧道验收。
4. 开放TCP 80/443；SSH仅向管理者IP开放。公网验证挑战文件能访问后申请证书：

```sh
docker compose -f deploy/compose-ip.yaml --profile tools run --rm certbot certonly \
  --preferred-profile shortlived --webroot --webroot-path /var/www/acme \
  --ip-address PUBLIC_IP --cert-name chunguorizi-ip
```

5. 用 `python3 deploy/ip-config.py PUBLIC_IP --tls` 生成HTTPS准备页，然后重建web容器（配置文件绑定挂载重写需重建），检查 `nginx -t` 和浏览器证书信任。
6. 测试续期 `certbot renew --dry-run`，设置root systemd timer每12小时执行 `deploy/renew-ip.sh`，读回timer和实际退出状态。续期成功后Nginx加载证书。
7. 用户验收同意公开后才运行 `python3 deploy/ip-config.py PUBLIC_IP --tls --publish`，重建web并核验完整路径。

## 结束比赛

在云平台设置自动释放实例和系统盘；仅关闭程序或停止实例不保证停止全部计费。源码、证据库和视频保留在本地/GitHub。公开API调用次数限额不等于人民币封顶，部署时仍需核实模型免费额度和云流量。

`runtime/`包含证书与运行配置，不提交、不发布。不要使用 `docker compose down -v` 清除额度账本，重启时须保留app-state。

## 流量与实时查询保护

- 实时酒店和地图查询默认全站100次/日、每IP 20次/日及小时；账本持久保存，达到限制使用示例和已收录资料。
- 部署主机安装 `vnstat` 后，`traffic-guard.py` 读取eth0当月收发总量。达到150GiB或统计失效时暂停本项目容器；需设置systemd timer每5分钟执行，保留50GiB余量。该本机统计不是阿里云权威账单，仍需核对账号其他资源对共享免费流量的消耗。
- 使用的百炼模型需在账号控制台开启免费额度用完即停；仅设置调用次数不能保证零额外模型费用。
