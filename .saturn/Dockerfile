FROM localhost/saturn-base:latest

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      jq ripgrep build-essential gh nodejs npm \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code

# Pre-install Playwright's chromium browser + system libs so e2e tests
# work in fresh containers. Pinned Playwright version comes from the
# project's package.json; this layer warms apt deps and the browser
# cache so `npx playwright test` doesn't re-download on every spin-up.
RUN npx --yes playwright@latest install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*
