plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.brunohrb.saude"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.brunohrb.saude"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "SUPABASE_URL", "\"https://hisbbtddpoxufvghxqtm.supabase.co\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhpc2JidGRkcG94dWZ2Z2h4cXRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMDM0OTgsImV4cCI6MjA4Nzc3OTQ5OH0.r3VkLkBxeorkCYjB-y6WOchePdfRKsm5lWE1iSSYlrw\"")
    }

    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.2")
    implementation("androidx.health.connect:connect-client:1.1.0")
}
