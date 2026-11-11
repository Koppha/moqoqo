// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

// server/ and portal/ are separate Node/web projects in this repo with their own node_modules.
// Keep Metro from crawling them; the apps only import the shared contract in shared/.
config.resolver.blockList = [/[\/](server|portal)[\/]node_modules[\/].*/]

module.exports = config
