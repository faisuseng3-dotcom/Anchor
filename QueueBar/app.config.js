// Extends app.json; secrets come from .env so they are never committed.
export default ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins ?? []),
    [
      '@rnmapbox/maps',
      {
        RNMapboxMapsVersion: '11.0.0',
        RNMapboxMapsDownloadToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN,
      },
    ],
  ],
});
