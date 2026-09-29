use reqwest::{Client, Method, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightState {
    pub power: bool,
    pub mode: String,
    pub front_brightness: u8,
    pub back_brightness: u8,
    pub temperature_k: u16,
    pub ultrasonic_enabled: bool,
    /// Absent from firmware that predates auto-dimming.
    #[serde(default)]
    pub auto_dimming: bool,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatePatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub power: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub front_brightness: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub back_brightness: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature_k: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ultrasonic_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_dimming: Option<bool>,
}
impl StatePatch {
    fn validate(&self, features: &Value) -> Result<Value, Fault> {
        let patch = serde_json::to_value(self).map_err(|_| protocol())?;
        if patch.as_object().is_none_or(|p| p.is_empty())
            || self
                .mode
                .as_deref()
                .is_some_and(|m| !matches!(m, "front" | "back" | "both"))
            || [self.front_brightness, self.back_brightness]
                .into_iter()
                .flatten()
                .any(|v| !(1..=100).contains(&v))
            || self
                .temperature_k
                .is_some_and(|v| !(2700..=6500).contains(&v) || v % 25 != 0)
        {
            return Err(Fault::new("INVALID_VALUE", "燈光設定超出支援範圍。"));
        }
        for key in patch.as_object().ok_or_else(protocol)?.keys() {
            // Power must stay verified. Lighting fields no longer need an opt-in
            // when the bridge reports them as experimental; unsupported still fails.
            let allowed = match features[key].as_str() {
                Some("verified") => true,
                Some("experimental") => key != "power",
                _ => false,
            };
            if !allowed {
                return Err(Fault::new("UNSUPPORTED_FIELD", "此裝置不支援該控制項。"));
            }
        }
        Ok(patch)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Desired {
    pub values: LightState,
    pub source: String,
    pub updated_at_uptime_ms: u64,
    pub command_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Observation {
    pub values: LightState,
    pub received_at_uptime_ms: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub device_id: String,
    pub boot_id: String,
    pub uptime_ms: u64,
    pub state_version: u64,
    pub control_revision: u64,
    pub desired: Desired,
    pub observed_remote: Option<Observation>,
    pub radio_status: String,
    pub radio_error_code: Option<String>,
    pub pairing_status: String,
    pub pairing_persisted: bool,
    pub lamp_confirmation: String,
    pub active_command: Option<Record>,
    pub last_command: Option<Record>,
    pub features: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tx {
    pub frames_planned: u8,
    pub frames_attempted: u8,
    pub frames_transmitted: u8,
    pub irq: Option<u8>,
    pub fifo: Option<u8>,
    pub mode: Option<u8>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Record {
    pub command_id: String,
    pub boot_id: String,
    pub status: String,
    pub effect: String,
    pub target: LightState,
    pub error: Option<Value>,
    pub tx: Tx,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fault {
    pub code: String,
    pub message: String,
    pub command_id: Option<String>,
    pub boot_id: Option<String>,
}
impl Fault {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            command_id: None,
            boot_id: None,
        }
    }
    fn unknown(command: &str, boot: &str) -> Self {
        Self {
            code: "UNKNOWN_OUTCOME".into(),
            message: "結果不明；請查詢結果，勿重複操作。".into(),
            command_id: Some(command.into()),
            boot_id: Some(boot.into()),
        }
    }
}
fn protocol() -> Fault {
    Fault::new(
        "PROTOCOL_ERROR",
        "裝置回應不符合 protocol v1，請確認韌體版本。",
    )
}
fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, Fault> {
    serde_json::from_value(value).map_err(|_| protocol())
}
pub fn endpoint(host: &str, port: u16) -> Result<Url, Fault> {
    let host = host.trim();
    if port == 0
        || host.is_empty()
        || host.len() > 253
        || host
            .chars()
            .any(|c| c.is_whitespace() || "/@?#\\%".contains(c))
    {
        return Err(Fault::new(
            "INVALID_HOST",
            "請輸入 IP 或主機名稱，不含 http://、路徑或帳密。",
        ));
    }
    let authority = match host.parse::<std::net::Ipv6Addr>() {
        Ok(_) => format!("[{host}]"),
        Err(_)
            if host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') =>
        {
            host.into()
        }
        _ => return Err(Fault::new("INVALID_HOST", "主機名稱格式不正確。")),
    };
    Url::parse(&format!("http://{authority}:{port}/api/v1/")).map_err(|_| protocol())
}

pub struct Bridge {
    http: Client,
    base: Url,
    username: String,
    password: String,
    client_id: String,
    pub device_id: String,
    pub info: Value,
    pending: Option<(String, String)>,
    next_command: Instant,
}
impl Bridge {
    pub async fn connect(
        host: &str,
        port: u16,
        username: String,
        password: String,
    ) -> Result<(Self, Snapshot), Fault> {
        if username.contains(':') || username.is_empty() || password.is_empty() {
            return Err(Fault::new(
                "INVALID_CREDENTIALS",
                "請填寫帳號與密碼；帳號不可含冒號。",
            ));
        }
        let http = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(4))
            .build()
            .map_err(|_| protocol())?;
        let mut bridge = Self {
            http,
            base: endpoint(host, port)?,
            username,
            password,
            client_id: Uuid::new_v4().to_string(),
            device_id: String::new(),
            info: Value::Null,
            pending: None,
            next_command: Instant::now(),
        };
        let info = bridge.request(Method::GET, "info", None).await?;
        if info["protocol"]["name"] != "halo2-bridge"
            || info["protocol"]["major"] != 1
            || info["capabilities"]["command_lookup"] != true
        {
            return Err(protocol());
        }
        bridge.device_id = info["device_id"]
            .as_str()
            .filter(|s| Uuid::parse_str(s).is_ok())
            .ok_or_else(protocol)?
            .into();
        bridge.info = info;
        let snapshot = bridge.snapshot().await?;
        if snapshot.boot_id != bridge.info["boot_id"] {
            return Err(Fault::new("BOOT_CHANGED", "裝置剛重新開機，請重新連線。"));
        }
        Ok((bridge, snapshot))
    }
    async fn request(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Value, Fault> {
        let mut request = self
            .http
            .request(method, self.base.join(path).map_err(|_| protocol())?)
            .basic_auth(&self.username, Some(&self.password))
            .header("Accept", "application/json");
        if let Some(body) = body {
            request = request.json(body);
        }
        let mut response = request
            .send()
            .await
            .map_err(|_| Fault::new("NETWORK", "無法連線或連線逾時，請確認裝置與區域網路。"))?;
        let status = response.status().as_u16();
        if status == 401 {
            return Err(Fault::new("UNAUTHORIZED", "帳號或密碼不正確。"));
        }
        if response
            .headers()
            .get("content-type")
            .and_then(|h| h.to_str().ok())
            .map(|s| s.split(';').next())
            != Some(Some("application/json"))
        {
            return Err(protocol());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| Fault::new("NETWORK", "回應中斷。"))?
        {
            if bytes.len() + chunk.len() > 8192 {
                return Err(protocol());
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| protocol())?;
        if status != 200 && status != 202 {
            let code = value["error"]["code"].as_str().ok_or_else(protocol)?;
            return Err(Fault::new(
                code,
                "裝置拒絕操作，請重新整理狀態後再決定是否操作。",
            ));
        }
        Ok(value)
    }
    pub async fn snapshot(&self) -> Result<Snapshot, Fault> {
        let s: Snapshot = decode(self.request(Method::GET, "state", None).await?)?;
        if s.device_id != self.device_id
            || Uuid::parse_str(&s.boot_id).is_err()
            || s.lamp_confirmation != "unavailable"
            || s.uptime_ms > 9_007_199_254_740_991
        {
            return Err(protocol());
        }
        Ok(s)
    }
    pub async fn power(&mut self, power: bool) -> Result<Record, Fault> {
        self.set_state(StatePatch {
            power: Some(power),
            ..Default::default()
        })
        .await
    }
    pub async fn set_state(&mut self, patch: StatePatch) -> Result<Record, Fault> {
        if let Some((id, boot)) = &self.pending {
            return Err(Fault::unknown(id, boot));
        }
        if Instant::now() < self.next_command {
            return Err(Fault::new("RATE_LIMITED", "請稍候再操作。"));
        }
        let state = self.snapshot().await?;
        let patch = patch.validate(&state.features)?;
        if state.radio_status != "ready" || state.pairing_status != "ready" {
            return Err(Fault::new(
                "RADIO_UNAVAILABLE",
                "裝置尚未就緒，或此配對的電源控制尚未驗證。",
            ));
        }
        if state.active_command.is_some() {
            return Err(Fault::new("BUSY", "裝置正在處理其他命令。"));
        }
        let id = Uuid::new_v4().to_string();
        let boot = state.boot_id;
        let request = json!({"command_id":id,"client_id":self.client_id,"boot_id":boot,
            "expected_revision":state.control_revision,"not_after_uptime_ms":state.uptime_ms+4000,
            "type":"set_state","patch":patch});
        self.pending = Some((id.clone(), boot.clone()));
        self.next_command = Instant::now() + Duration::from_millis(500);
        match self.request(Method::POST, "commands", Some(&request)).await {
            Ok(value) => {
                let record: Record = decode(value).map_err(|_| Fault::unknown(&id, &boot))?;
                if let Some(record) = terminal(record, &id, &boot)? {
                    self.pending = None;
                    return Ok(record);
                }
            }
            Err(error) => {
                // Network/protocol failures can occur after admission. Never replay POST.
                if matches!(error.code.as_str(), "NETWORK" | "PROTOCOL_ERROR") {
                    return Err(Fault::unknown(&id, &boot));
                }
                self.pending = None;
                return Err(error);
            }
        }
        for _ in 0..10 {
            tokio::time::sleep(Duration::from_millis(200)).await;
            if let Some(record) = self.lookup_pending().await? {
                return Ok(record);
            }
        }
        Err(Fault::unknown(&id, &boot))
    }
    pub async fn lookup_pending(&mut self) -> Result<Option<Record>, Fault> {
        let Some((id, boot)) = self.pending.clone() else {
            return Ok(None);
        };
        let value = self
            .request(Method::GET, &format!("commands/{id}?boot_id={boot}"), None)
            .await
            .map_err(|_| Fault::unknown(&id, &boot))?;
        let record = decode(value).map_err(|_| Fault::unknown(&id, &boot))?;
        let result = terminal(record, &id, &boot)?;
        if result.is_some() {
            self.pending = None;
        }
        Ok(result)
    }
}

fn terminal(record: Record, id: &str, boot: &str) -> Result<Option<Record>, Fault> {
    if record.command_id != id || record.boot_id != boot {
        return Err(Fault::unknown(id, boot));
    }
    match record.status.as_str() {
        "accepted" | "executing" => Ok(None),
        "transmitted"
            if record.effect == "unconfirmed"
                && record.error.is_none()
                && record.tx.frames_planned > 0
                && record.tx.frames_planned <= 2
                && record.tx.frames_attempted == record.tx.frames_planned
                && record.tx.frames_transmitted == record.tx.frames_planned =>
        {
            Ok(Some(record))
        }
        "failed" | "expired" | "superseded" => Ok(Some(record)),
        _ => Err(Fault::unknown(id, boot)),
    }
}

#[cfg(test)]
mod tests;
