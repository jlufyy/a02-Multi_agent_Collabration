FROM node:22-slim AS web
WORKDIR /app/tripflow-frontend/tripflow
COPY packages/context-engine /app/packages/context-engine
COPY packages/contracts /app/packages/contracts
COPY tripflow-frontend/tripflow/package*.json ./
COPY tripflow-frontend/tripflow/packages ./packages
COPY tripflow-frontend/tripflow/apps/web ./apps/web
RUN npm ci --no-audit --no-fund && npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8000
WORKDIR /app
COPY apps/api/pyproject.toml /app/apps/api/pyproject.toml
COPY apps/api/app /app/apps/api/app
COPY apps/api/requirements-lock.txt /app/apps/api/requirements-lock.txt
RUN pip install --no-cache-dir -c /app/apps/api/requirements-lock.txt /app/apps/api
COPY packages/context-engine/geo-policy.json /app/packages/context-engine/geo-policy.json
COPY apps/api/serve.py /app/apps/api/serve.py
COPY --from=web /app/tripflow-frontend/tripflow/apps/web/dist /app/tripflow-frontend/tripflow/apps/web/dist
RUN useradd --create-home --uid 10001 tripflow
USER tripflow
EXPOSE 8000
CMD ["python", "apps/api/serve.py"]
