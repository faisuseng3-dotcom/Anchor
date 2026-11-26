#!/bin/sh
# Xcode Cloud: klonen har ingen node_modules (Swift-paketen för plats och notiser ligger där, se CapApp-SPM/Package.swift)
# och ingen ios/App/App/public (webbygget, ignorerat i git). Bygg dem som på datorn: npm ci, npm run build, cap sync.
set -e
# Kartans token för appen finns inte i repot (.env på datorn): lägg den som hemlig miljövariabel i arbetsflödet.
: "${VITE_MAPBOX_TOKEN:?saknas: Xcode Cloud → arbetsflödet → Environment → lägg till VITE_MAPBOX_TOKEN (Secret, token Qbar app)}"
brew install node
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm ci
npm run build
npx cap sync ios
