"use client";

import SystemStorageTab from "../components/SystemStorageTab";
import SmtpSettings from "./SmtpSettings";

export default function SettingsStoragePage() {
  return (
    <div className="space-y-6">
      <SystemStorageTab />
      <SmtpSettings />
    </div>
  );
}
