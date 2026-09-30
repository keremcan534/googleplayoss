// Unity ile yapılmış örnek bir tır/kargo oyunu reposu (test fixture'ı).
export const TRUCK_README = `# Road Haul

A truck driving game made with Unity. Haul cargo across mountain roads and highways,
hitch trailers and upgrade your truck in the garage. Runs at 60 fps on mid-range phones.

## Features
- Deliver cargo between 12 cities
- Hitch and haul heavy trailers
- Upgrade engine, tires and paint in the garage
- Dynamic weather with rain and night driving
- Works offline, no internet required

## Build
- Open the project in Unity 2022.3 LTS
- Build for Android (see release notes in CHANGELOG)
- [Documentation](https://example.com/docs)
`;

export const TRUCK_FILES = {
  'README.md': TRUCK_README,
  'ProjectSettings/ProjectSettings.asset': `%YAML 1.1
PlayerSettings:
  companyName: Anatolia Games
  productName: Road Haul
  bundleVersion: 1.4.0
  applicationIdentifier:
    Android: com.anatolia.roadhaul
    Standalone: com.anatolia.roadhaul
  AndroidBundleVersionCode: 14
  AndroidMinSdkVersion: 24
  AndroidTargetSdkVersion: 34
`,
  'Packages/manifest.json': JSON.stringify({ dependencies: { 'com.unity.ads': '4.4.2', 'com.unity.render-pipelines.universal': '14.0.8', 'com.unity.textmeshpro': '3.0.6' } }),
  'Assets/Plugins/Android/AndroidManifest.xml': `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools" package="com.unity3d.player">
  <uses-permission android:name="android.permission.INTERNET" />
  <uses-permission android:name="com.google.android.gms.permission.AD_ID" />
  <uses-permission android:name="android.permission.READ_PHONE_STATE" tools:node="remove" />
  <application android:label="@string/app_name" />
</manifest>`
};

export const TRUCK_PATHS = [
  ...Object.keys(TRUCK_FILES),
  'Assets/Scenes/Main.unity',
  'Assets/Scripts/TruckController.cs',
  'Assets/Scripts/CargoDelivery.cs',
  'Assets/Scripts/TrailerHitch.cs',
  'Assets/Scripts/GarageUpgradeManager.cs',
  'Assets/Scripts/WeatherSystem.cs',
  'Assets/Scripts/UIManager.cs',
  'Assets/Scripts/AdsInitializer.cs',
  'Assets/GoogleMobileAds/Editor/GoogleMobileAdsDependencies.xml',
  'Assets/Plugins/Android/googlemobileads-unity.aar',
  'Library/ScriptAssemblies/Assembly-CSharp.dll'
];
