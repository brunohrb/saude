package com.brunohrb.saude

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.temporal.ChronoUnit

class MainActivity : AppCompatActivity() {
    private val sleepPermission = HealthPermission.getReadPermission(SleepSessionRecord::class)
    private lateinit var status: TextView
    private lateinit var email: EditText
    private lateinit var password: EditText
    private var healthClient: HealthConnectClient? = null

    private val permissionLauncher = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract()
    ) { granted ->
        status.text = if (granted.contains(sleepPermission))
            "Permissão concedida. Agora toque em Sincronizar."
        else "A permissão de sono não foi concedida."
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        status = findViewById(R.id.status)
        email = findViewById(R.id.email)
        password = findViewById(R.id.password)

        val sdkStatus = HealthConnectClient.getSdkStatus(this)
        if (sdkStatus == HealthConnectClient.SDK_AVAILABLE) {
            healthClient = HealthConnectClient.getOrCreate(this)
        } else {
            status.text = "Health Connect não está disponível ou precisa ser atualizado neste celular."
        }

        val prefs = getSharedPreferences("saude_bhr", MODE_PRIVATE)
        email.setText(prefs.getString("email", ""))

        findViewById<Button>(R.id.login).setOnClickListener { login() }
        findViewById<Button>(R.id.permission).setOnClickListener {
            if (healthClient == null) status.text = "Health Connect indisponível."
            else permissionLauncher.launch(setOf(sleepPermission))
        }
        findViewById<Button>(R.id.sync).setOnClickListener { syncSleep() }
    }

    private fun login() = lifecycleScope.launch {
        val mail = email.text.toString().trim()
        val pass = password.text.toString()
        if (mail.isBlank() || pass.isBlank()) {
            status.text = "Digite seu e-mail e sua senha."
            return@launch
        }
        status.text = "Entrando..."
        try {
            val token = withContext(Dispatchers.IO) { authenticate(mail, pass) }
            getSharedPreferences("saude_bhr", MODE_PRIVATE).edit()
                .putString("email", mail).putString("access_token", token).apply()
            password.text.clear()
            status.text = "Conectado com segurança. Agora permita o acesso ao sono."
        } catch (e: Exception) {
            status.text = "Não foi possível entrar: ${e.message}"
        }
    }

    private fun syncSleep() = lifecycleScope.launch {
        val client = healthClient ?: run {
            status.text = "Health Connect indisponível."
            return@launch
        }
        val token = getSharedPreferences("saude_bhr", MODE_PRIVATE)
            .getString("access_token", null) ?: run {
            status.text = "Primeiro entre na sua conta."
            return@launch
        }
        if (!client.permissionController.getGrantedPermissions().contains(sleepPermission)) {
            status.text = "Primeiro conceda a permissão de sono."
            return@launch
        }

        status.text = "Lendo o sono do celular..."
        try {
            val records = readAllSleep(client)
            if (records.isEmpty()) {
                status.text = "Nenhum sono encontrado nos últimos 90 dias. Confira se o Samsung Health compartilha o sono com o Health Connect."
                return@launch
            }
            val payload = JSONObject().put("records", JSONArray(records.map(::recordToJson)))
            val imported = withContext(Dispatchers.IO) { upload(token, payload) }
            status.text = "Pronto: $imported registros de sono sincronizados. Já pode atualizar o site Saúde BHR."
        } catch (e: Exception) {
            status.text = "Falha na sincronização: ${e.message}"
        }
    }

    private suspend fun readAllSleep(client: HealthConnectClient): List<SleepSessionRecord> {
        val all = mutableListOf<SleepSessionRecord>()
        var pageToken: String? = null
        do {
            val response = client.readRecords(
                ReadRecordsRequest(
                    recordType = SleepSessionRecord::class,
                    timeRangeFilter = TimeRangeFilter.between(
                        Instant.now().minus(90, ChronoUnit.DAYS), Instant.now()
                    ),
                    pageSize = 100,
                    pageToken = pageToken
                )
            )
            all += response.records
            pageToken = response.pageToken
        } while (pageToken != null)
        return all
    }

    private fun recordToJson(record: SleepSessionRecord): JSONObject {
        var awake = 0L; var light = 0L; var deep = 0L; var rem = 0L
        record.stages.forEach { stage ->
            val millis = stage.endTime.toEpochMilli() - stage.startTime.toEpochMilli()
            when (stage.stage) {
                SleepSessionRecord.STAGE_TYPE_AWAKE,
                SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED,
                SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> awake += millis
                SleepSessionRecord.STAGE_TYPE_LIGHT -> light += millis
                SleepSessionRecord.STAGE_TYPE_DEEP -> deep += millis
                SleepSessionRecord.STAGE_TYPE_REM -> rem += millis
                SleepSessionRecord.STAGE_TYPE_SLEEPING -> light += millis
            }
        }
        return JSONObject()
            .put("id", record.metadata.id)
            .put("start_time", record.startTime.toString())
            .put("end_time", record.endTime.toString())
            .put("awake_millis", awake)
            .put("light_millis", light)
            .put("deep_millis", deep)
            .put("rem_millis", rem)
    }

    private fun authenticate(mail: String, pass: String): String {
        val body = JSONObject().put("email", mail).put("password", pass).toString()
        val response = request(
            "${BuildConfig.SUPABASE_URL}/auth/v1/token?grant_type=password",
            body,
            mapOf("apikey" to BuildConfig.SUPABASE_ANON_KEY)
        )
        return JSONObject(response).getString("access_token")
    }

    private fun upload(token: String, payload: JSONObject): Int {
        val response = request(
            "${BuildConfig.SUPABASE_URL}/functions/v1/health-connect-import",
            payload.toString(),
            mapOf(
                "apikey" to BuildConfig.SUPABASE_ANON_KEY,
                "Authorization" to "Bearer $token"
            )
        )
        return JSONObject(response).getInt("imported")
    }

    private fun request(endpoint: String, body: String, headers: Map<String, String>): String {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.doOutput = true
        connection.connectTimeout = 20_000
        connection.readTimeout = 60_000
        connection.setRequestProperty("Content-Type", "application/json")
        headers.forEach(connection::setRequestProperty)
        connection.outputStream.use { it.write(body.toByteArray()) }
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val response = stream.bufferedReader().use { it.readText() }
        if (code !in 200..299) throw IllegalStateException("HTTP $code: ${response.take(250)}")
        return response
    }
}
