# Builds an installable Android APK with no Android tools on your computer.
# Use `npm run docker:apk -- <server address>`; the file lands in dist-apk/.
FROM node:22-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jdk-headless unzip && rm -rf /var/lib/apt/lists/*

ENV ANDROID_HOME=/opt/android
RUN mkdir -p $ANDROID_HOME/cmdline-tools \
  && curl -fsSL -o /tmp/tools.zip https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip \
  && unzip -q /tmp/tools.zip -d $ANDROID_HOME/cmdline-tools \
  && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
  && rm /tmp/tools.zip \
  && (yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses > /dev/null)

WORKDIR /repo
COPY packages/core packages/core
COPY apps/mobile/package.json apps/mobile/package-lock.json apps/mobile/
WORKDIR /repo/apps/mobile
RUN npm ci --no-audit --no-fund
COPY apps/mobile .

# The address the app uses first. It can be changed later on the app's welcome screen.
ARG API_URL
ENV EXPO_PUBLIC_API_URL=$API_URL CI=1 EXPO_NO_TELEMETRY=1
RUN test -n "$API_URL" || (echo "Pass the server address: --build-arg API_URL=http://..." && exit 1)
RUN npx expo prebuild --platform android --no-install

# Gradle downloads the exact Android SDK, build tools and NDK this project asks for. Those are large,
# so allow for slow connections, and fetch Gradle itself in its own step so a retry doesn't repeat it.
WORKDIR /repo/apps/mobile/android
ENV GRADLE_OPTS="-Djava.net.preferIPv4Stack=true -Dorg.gradle.internal.http.connectionTimeout=120000 -Dorg.gradle.internal.http.socketTimeout=120000 -Dorg.gradle.internal.repository.max.retries=5"
RUN sed -i 's/^networkTimeout=.*/networkTimeout=120000/' gradle/wrapper/gradle-wrapper.properties \
  && (./gradlew --version || (sleep 20 && ./gradlew --version) || (sleep 60 && ./gradlew --version))
RUN ./gradlew assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a,armeabi-v7a

# Fail here, not on someone's phone, if the APK cannot be installed.
RUN mkdir /out && cp app/build/outputs/apk/release/app-release.apk /out/TimeFlex.apk \
  && "$(ls -d $ANDROID_HOME/build-tools/* | sort -V | tail -n 1)/apksigner" verify /out/TimeFlex.apk

FROM scratch
COPY --from=build /out/TimeFlex.apk /TimeFlex.apk
