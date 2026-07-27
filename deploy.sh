#!/bin/bash
set -e

echo "=========================================="
echo "🚀 AI Marketing Agent - Deployment Script"
echo "=========================================="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed!${NC}"
    exit 1
fi

# 检查 docker-compose 是否安装
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ docker-compose is not installed!${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Stopping old container...${NC}"
docker-compose down || true

echo -e "${YELLOW}🗑️  Removing old image...${NC}"
docker rmi ai-marketing-agent:latest 2>/dev/null || echo "No old image to remove"

echo -e "${YELLOW}🔨 Building new Docker image...${NC}"
docker build -t ai-marketing-agent:latest .

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Docker build failed!${NC}"
    exit 1
fi

echo -e "${YELLOW}🚀 Starting services with docker-compose...${NC}"
docker-compose build newsletter-api
docker-compose up -d

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to start services!${NC}"
    exit 1
fi

# 等待容器启动
echo -e "${YELLOW}⏳ Waiting for container to be healthy...${NC}"
sleep 3

echo -e "${GREEN}✅ Checking container status...${NC}"
docker-compose ps

echo -e "${YELLOW}📄 Container logs (last 20 lines):${NC}"
docker logs --tail 20 ai-markting-front

echo -e "${YELLOW}🧹 Cleaning up dangling images...${NC}"
docker image prune -f || true

echo -e "${GREEN}=========================================="
echo -e "✨ Deployment completed successfully!"
echo -e "🌐 Service is running on port 8001"
echo -e "==========================================${NC}"
