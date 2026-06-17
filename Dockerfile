FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV PATH="/root/.cargo/bin:${PATH}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    clang \
    curl \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libsoup-3.0-dev \
    libssl-dev \
    libwebkit2gtk-4.1-dev \
    perl \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --profile minimal --default-toolchain stable

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src-tauri/Cargo.toml src-tauri/Cargo.lock ./src-tauri/
RUN mkdir -p src-tauri/src \
  && printf "fn main() {}" > src-tauri/src/lib.rs \
  && cargo fetch --manifest-path src-tauri/Cargo.toml

COPY . .

CMD ["bash"]
