// src/views/ProfileView.jsx
import { useState, useEffect } from "react";
import { supabase } from "../utils/supabase";
import { C, displayName } from "../utils/helpers";
import { Fld, Inp, Btn } from "../components/UIPrimitives";
import { dispatchSMSAlert } from "../utils/helpers";
import { sendEmail } from "../utils/email";

export default function ProfileView({ user, onUpdateUser }) {
  // Identity Info States
  const [name, setName] = useState(user.name || user.full_name || "");
  const [submittingProfile, setSubmittingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState({ text: "", isError: false });

  // Low Stock Routing Alert States
  const [alertPhone, setAlertPhone] = useState(user?.phone_number || "");
  const [alertSms, setAlertSms] = useState(user?.receive_sms_alerts || false);
  const [alertEmail, setAlertEmail] = useState(
    user?.receive_email_alerts || false,
  );
  const [savingAlerts, setSavingAlerts] = useState(false);
  const [alertMsg, setAlertMsg] = useState({ text: "", isError: false });

  // Access Credentials States
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [submittingPass, setSubmittingPass] = useState(false);
  const [passMsg, setPassMsg] = useState({ text: "", isError: false });

  // Sync internal alerts values if user changes globally
  useEffect(() => {
    if (user) {
      setName(user.name || user.full_name || "");
      setAlertPhone(user.phone_number || "");
      setAlertSms(user.receive_sms_alerts || false);
      setAlertEmail(user.receive_email_alerts || false);
    }
  }, [user]);

  // Action 1: Handle Profile Name Updates
  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setProfileMsg({ text: "", isError: false });
    if (!name.trim())
      return setProfileMsg({ text: "Name cannot be empty.", isError: true });

    setSubmittingProfile(true);
    const { error: authError } = await supabase.auth.updateUser({
      data: { display_name: name.trim() },
    });

    if (authError) {
      setSubmittingProfile(false);
      return setProfileMsg({
        text: `Auth Error: ${authError.message}`,
        isError: true,
      });
    }

    const { error: dbError } = await supabase
      .from("profiles")
      .update({ full_name: name.trim() })
      .eq("id", user.id);

    setSubmittingProfile(false);

    if (dbError) {
      setProfileMsg({
        text: `Database Error: ${dbError.message}`,
        isError: true,
      });
    } else {
      setProfileMsg({ text: "🎉 Profile permanently saved!", isError: false });
      onUpdateUser({ ...user, name: name.trim(), full_name: name.trim() });
    }
  };

  // Action 2: Handle Low Stock Notification Routing Rules
  const saveNotificationPreferences = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setAlertMsg({ text: "", isError: false });

    setSavingAlerts(true);

    // 1. Save preferences to the database profile row
    const { error } = await supabase
      .from("profiles")
      .update({
        phone_number: alertPhone.trim(),
        receive_sms_alerts: alertSms,
        receive_email_alerts: alertEmail,
      })
      .eq("id", user.id);

    if (error) {
      setSavingAlerts(false);
      return setAlertMsg({
        text: `Error updating routing: ${error.message}`,
        isError: true,
      });
    }

    // 2. If Email Alerts are enabled, send an immediate free confirmation receipt
    if (alertEmail && user?.email) {
      const confirmMessage =
        "⚙️ MRR System Note: Your inventory alert subscription has been successfully updated! You will now receive notifications here whenever items drop below threshold values.";

      try {
        await sendEmail({
          to: user.email,
          subject: "✅ Notification Channels Confirmed",
          html: `<p>${confirmMessage}</p>`,
        });
      } catch (err) {
        console.error(
          "Failed to dispatch email confirmation receipt payload:",
          err,
        );
      }
    }

    // Pass states upstream so the configuration sticks globally
    onUpdateUser({
      ...user,
      phone_number: alertPhone.trim(),
      receive_sms_alerts: alertSms,
      receive_email_alerts: alertEmail,
    });

    setSavingAlerts(false);
    setAlertMsg({
      text: "🔔 Alert preferences updated! Confirmation sent.",
      isError: false,
    });
  };

  // Action 3: Handle Security Password Modification Requests
  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPassMsg({ text: "", isError: false });

    if (newPass.length < 8) {
      return setPassMsg({
        text: "New password must be at least 8 characters long.",
        isError: true,
      });
    }
    if (newPass !== confirmPass) {
      return setPassMsg({ text: "New passwords do not match.", isError: true });
    }

    setSubmittingPass(true);
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPass,
    });

    if (verifyError) {
      setSubmittingPass(false);
      return setPassMsg({
        text: "Incorrect current password. Please try again.",
        isError: true,
      });
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPass,
    });
    setSubmittingPass(false);

    if (updateError) {
      setPassMsg({
        text: `System Error: ${updateError.message}`,
        isError: true,
      });
    } else {
      setPassMsg({ text: "🎉 Password updated successfully!", isError: false });
      setCurrentPass("");
      setNewPass("");
      setConfirmPass("");
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-8)",
        maxWidth: 500,
        margin: "20px auto",
      }}
    >
      {/* CARD 1: Identity Profile Credentials */}
      <div
        style={{
          background: C.w,
          borderRadius: "var(--radius-xl)",
          padding: 24,
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <h1
          style={{
            margin: "0 0 6px",
            fontSize: "var(--text-2xl)",
            fontWeight: "var(--weight-black)",
            color: C.navy,
          }}
        >
          👤 Personal Profile
        </h1>
        <p style={{ margin: "0 0 20px", color: C.sub, fontSize: "var(--text-base)" }}>
          Manage your account identity details
        </p>

        <form onSubmit={handleProfileUpdate}>
          <Fld label="Full Name">
            <Inp
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Fld>
          <Fld label="Email Address">
            <Inp
              type="email"
              value={user.email}
              disabled
              style={{
                background: "#f5f5f5",
                color: C.sub,
                cursor: "not-allowed",
              }}
            />
          </Fld>
          <Fld label="System Permissions Level">
            <div
              style={{
                background: "rgba(245,168,0,0.08)",
                border: `1px solid ${C.gold}`,
                color: C.navy,
                padding: "8px 12px",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--text-base)",
                fontWeight: "var(--weight-bold)",
                textTransform: "capitalize",
              }}
            >
              🛡️ {user.role || "Employee"} Account
            </div>
          </Fld>
          {profileMsg.text && (
            <div
              style={{
                background: profileMsg.isError ? C.rB : C.gB,
                color: profileMsg.isError ? C.rd : C.gr,
                padding: "10px 14px",
                borderRadius: "var(--radius-md)",
                fontSize: "var(--text-base)",
                marginBottom: 16,
                fontWeight: "var(--weight-semibold)",
              }}
            >
              {profileMsg.text}
            </div>
          )}
          <Btn
            v="gold"
            type="submit"
            style={{ width: "100%", justifyContent: "center" }}
            disabled={submittingProfile}
          >
            {submittingProfile ? "Saving Changes..." : "Save Profile Details"}
          </Btn>
        </form>
      </div>

      {/* CARD 2: Low Stock Dynamic Notification Toggles */}
      <div
        style={{
          background: C.w,
          borderRadius: "var(--radius-xl)",
          padding: 24,
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-4)",
            marginBottom: 6,
          }}
        >
          <span style={{ fontSize: "var(--text-2xl)" }}>🔔</span>
          <h3
            style={{ margin: 0, fontSize: "var(--text-xl)", fontWeight: "var(--weight-black)", color: C.navy }}
          >
            Inventory Alert Preferences
          </h3>
        </div>
        <p style={{ margin: "0 0 20px 0", color: C.sub, fontSize: "var(--text-base)" }}>
          Choose how you want to be notified when items hit low-stock
          thresholds.
        </p>

        {/* ── PHONE NUMBER ROUTING ENTRY ── */}
        <Fld label="Cell Phone Number (For SMS)">
          <Inp
            type="tel"
            value={alertPhone}
            onChange={(e) => setAlertPhone(e.target.value)}
            placeholder="(xxx) xxx-xxxx"
          />
        </Fld>

        {/* ── NEW DYNAMIC READ-ONLY EMAIL ROUTING LABEL ── */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: "var(--text-xs)",
              fontWeight: "var(--weight-bold)",
              color: C.navy,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: 6,
            }}
          >
            Connected Alert Email
          </div>
          <div
            style={{
              background: C.lg,
              padding: "10px 14px",
              borderRadius: "var(--radius-md)",
              fontSize: "var(--text-base)",
              color: C.sub,
              fontFamily: "monospace",
              border: `1.5px solid ${C.bd}`,
            }}
          >
            📧 {user?.email || "No email associated with this profile"}
          </div>
        </div>

        {/* ── NOTIFICATION ROUTING TOGGLES ── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-5)",
            marginBottom: 20,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-4)",
              fontSize: "var(--text-base)",
              fontWeight: "var(--weight-semibold)",
              color: C.navy,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={alertSms}
              onChange={(e) => setAlertSms(e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            Enable Text Message (SMS) Alerts
          </label>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-4)",
              fontSize: "var(--text-base)",
              fontWeight: "var(--weight-semibold)",
              color: C.navy,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={alertEmail}
              onChange={(e) => setAlertEmail(e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            Enable Email Notifications
          </label>
        </div>

        {alertMsg.text && (
          <div
            style={{
              background: alertMsg.isError ? C.rB : C.gB,
              color: alertMsg.isError ? C.rd : C.gr,
              padding: "10px 14px",
              borderRadius: "var(--radius-md)",
              fontSize: "var(--text-base)",
              marginBottom: 16,
              fontWeight: "var(--weight-semibold)",
            }}
          >
            {alertMsg.text}
          </div>
        )}

        <Btn
          v="primary"
          onClick={saveNotificationPreferences}
          disabled={savingAlerts}
          style={{ width: "100%", justifyContent: "center" }}
        >
          {savingAlerts ? "Saving Settings..." : "Save Notification Prefs"}
        </Btn>
      </div>

      {/* CARD 3: Account Access Security Credentials */}
      <div
        style={{
          background: C.w,
          borderRadius: "var(--radius-xl)",
          padding: 24,
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <h2
          style={{
            margin: "0 0 6px",
            fontSize: "var(--text-xl)",
            fontWeight: "var(--weight-black)",
            color: C.navy,
          }}
        >
          🔐 Access Credentials
        </h2>
        <p style={{ margin: "0 0 20px", color: C.sub, fontSize: "var(--text-base)" }}>
          Change your current login security details
        </p>

        <form onSubmit={handlePasswordChange}>
          <Fld label="Current Password">
            <Inp
              type="password"
              value={currentPass}
              onChange={(e) => setCurrentPass(e.target.value)}
              required
            />
          </Fld>
          <hr
            style={{
              border: "none",
              borderTop: `1px dashed ${C.bd}`,
              margin: "16px 0",
            }}
          />
          <Fld label="New Password">
            <Inp
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              required
            />
          </Fld>
          <Fld label="Confirm New Password">
            <Inp
              type="password"
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
              required
            />
          </Fld>
          {passMsg.text && (
            <div
              style={{
                background: passMsg.isError ? C.rB : C.gB,
                color: passMsg.isError ? C.rd : C.gr,
                padding: "10px 14px",
                borderRadius: "var(--radius-md)",
                fontSize: "var(--text-base)",
                marginBottom: 16,
                fontWeight: "var(--weight-semibold)",
              }}
            >
              {passMsg.text}
            </div>
          )}
          <Btn
            v="gold"
            type="submit"
            style={{ width: "100%", justifyContent: "center" }}
            disabled={submittingPass}
          >
            {submittingPass ? "Updating..." : "Update Password"}
          </Btn>
        </form>
      </div>
    </div>
  );
}
