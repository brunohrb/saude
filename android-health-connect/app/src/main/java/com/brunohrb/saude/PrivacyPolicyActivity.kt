package com.brunohrb.saude

import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class PrivacyPolicyActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(TextView(this).apply {
            setPadding(48, 64, 48, 48)
            textSize = 17f
            text = "Política de privacidade\n\nO Saúde BHR acessa somente seus dados de sono do Health Connect após sua autorização. Os dados são enviados de forma criptografada para sua própria conta no Saúde BHR e não são vendidos nem compartilhados com terceiros. Você pode revogar a permissão a qualquer momento nas configurações do Health Connect."
        })
    }
}
