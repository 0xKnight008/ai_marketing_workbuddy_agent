# ============================================
# Stage 1: Build - 在 Node.js 环境中构建前端
# ============================================
FROM node:20-alpine AS builder

# 设置工作目录
WORKDIR /app

# 设置环境变量优化构建（针对低配服务器）
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=2048"

# 先复制 package 文件，利用 Docker 缓存层
COPY package.json package-lock.json ./

# 使用淘宝镜像源避免网络问题
RUN npm config set registry https://registry.npmmirror.com && \
    npm ci && \
    npm install --frozen-lockfile

# 复制源代码
COPY . .

# 执行构建，生成 dist/ 目录
RUN npm run build

# 验证构建产物是否存在
RUN ls -la dist/

# ============================================
# Stage 2: Production - 用 Nginx 提供静态文件
# ============================================
FROM nginx:1.27-alpine

# 删除 Nginx 默认配置
RUN rm /etc/nginx/conf.d/default.conf

# 复制自定义 Nginx 配置
COPY nginx.conf /etc/nginx/conf.d/app.conf

# 从 builder 阶段复制构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 验证文件已复制
RUN ls -la /usr/share/nginx/html/

# 暴露端口
EXPOSE 80

# 启动 Nginx
CMD ["nginx", "-g", "daemon off;"]
