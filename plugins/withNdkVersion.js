// Pins the Android NDK version so the build uses an NDK that's already installed
// instead of downloading React Native's default (27.1, ~1 GB).
// Expo's root-project plugin only sets ndkVersion if nothing set it first.
const { withProjectBuildGradle } = require('expo/config-plugins')

const MARKER = '// moqoqo: ndkVersion'

module.exports = function withNdkVersion(config, { version }) {
  return withProjectBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents
    if (!src.includes(MARKER)) {
      src = src.replace(
        'apply plugin: "expo-root-project"',
        `ext.ndkVersion = "${version}" ${MARKER}\napply plugin: "expo-root-project"`,
      )
    }
    cfg.modResults.contents = src
    return cfg
  })
}
