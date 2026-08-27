# Saúde BHR — Android Health Connect

Aplicativo auxiliar que lê `SleepSessionRecord` do Health Connect e envia os registros para a conta autenticada no Saúde BHR.

## Compilar

1. Instale Android Studio (JDK 17 e Android SDK 35).
2. Abra esta pasta no Android Studio.
3. Aguarde o Gradle sincronizar e escolha **Build > Build APK(s)**.
4. Instale `app/build/outputs/apk/debug/app-debug.apk` no celular.

No primeiro uso: entre com o mesmo e-mail/senha do Saúde BHR, conceda acesso ao sono e toque em **Sincronizar agora**.

O APK contém apenas a chave pública `anon` do Supabase. O backend ignora qualquer `user_id` enviado pelo aparelho e associa os dados exclusivamente ao usuário validado pelo JWT.
