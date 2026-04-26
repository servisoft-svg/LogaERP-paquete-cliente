#!/bin/bash
echo "Building Loga ERP frontend for production..."
npm run build
echo "Build complete. Files in dist/"
echo "Serve with: npx serve dist -s -l 5173"
