FROM node:24-bookworm

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    gosu \
    procps \
    python3 \
    python3-pip \
    build-essential \
    jq \
    ffmpeg \
    netcat-openbsd \
  && rm -rf /var/lib/apt/lists/*

# Install Python dependencies for skills (e.g. web-search uses duckduckgo-search)
RUN pip install --break-system-packages duckduckgo-search

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*

RUN npm install -g openclaw@latest wrangler@latest @railway/cli@latest clawhub@latest

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

# Build SvelteKit dashboard (separate layer for caching)
COPY dashboard/package.json ./dashboard/
RUN cd dashboard && npm install
COPY dashboard/ ./dashboard/
RUN cd dashboard && npm run build

COPY src ./src
COPY workspace-templates ./workspace-templates
COPY entrypoint.sh ./entrypoint.sh

RUN useradd -m -s /bin/bash openclaw \
  && chown -R openclaw:openclaw /app \
  && mkdir -p /data && chown openclaw:openclaw /data \
  && mkdir -p /home/linuxbrew/.linuxbrew && chown -R openclaw:openclaw /home/linuxbrew

USER openclaw
RUN NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:${PATH}"
ENV HOMEBREW_PREFIX="/home/linuxbrew/.linuxbrew"
ENV HOMEBREW_CELLAR="/home/linuxbrew/.linuxbrew/Cellar"
ENV HOMEBREW_REPOSITORY="/home/linuxbrew/.linuxbrew/Homebrew"

# Install skill dependencies via brew (uv for nano-banana-pro, himalaya for email)
RUN brew install uv himalaya

# Create npx wrapper scripts for skill CLIs not available via brew/apt
RUN mkdir -p /home/openclaw/.local/bin \
  && for cmd in clawhub summarize mcporter xurl obsidian-cli oracle gemini; do \
       case "$cmd" in \
         gemini) pkg="@google/gemini-cli" ;; \
         *) pkg="$cmd" ;; \
       esac; \
       printf '#!/bin/sh\nexec npx %s@latest "$@"\n' "$pkg" > "/home/openclaw/.local/bin/$cmd"; \
       chmod +x "/home/openclaw/.local/bin/$cmd"; \
     done \
  && printf '#!/bin/sh\nexec npx @anthropic-ai/claude-code@latest "$@"\n' > /home/openclaw/.local/bin/claude \
  && chmod +x /home/openclaw/.local/bin/claude

ENV PATH="/home/openclaw/.local/bin:${PATH}"
ENV PORT=8080
ENV OPENCLAW_ENTRY=/usr/local/lib/node_modules/openclaw/dist/entry.js
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:8080/setup/healthz || exit 1

USER root
ENTRYPOINT ["./entrypoint.sh"]
