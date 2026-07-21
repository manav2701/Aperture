#!/bin/bash
set -e
. "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

echo "Setting Rust toolchain to stable..."
rustup override unset || true

echo "Generating fresh lockfile..."
rm -f Cargo.lock
cargo generate-lockfile

echo "Downgrading dependencies to satisfy SBF Cargo 1.75.0 compiler..."
cargo update -p blake3@1.8.5 --precise 1.5.0
cargo update -p zeroize_derive@1.5.0 --precise 1.4.2
cargo update -p borsh@1.8.0 --precise 1.5.1
cargo update -p proc-macro-crate@3.5.0 --precise 3.0.0
cargo update -p indexmap@2.14.0 --precise 2.5.0
cargo update -p cc@1.3.0 --precise 1.0.99
cargo update -p jobserver@0.1.35 --precise 0.1.32
cargo update -p unicode-segmentation@1.13.3 --precise 1.11.0

echo "Downgrading lockfile format to version 3 for SBF compiler compatibility..."
sed -i 's/version = 4/version = 3/g' Cargo.lock

echo "Building Anchor workspace..."
anchor build
