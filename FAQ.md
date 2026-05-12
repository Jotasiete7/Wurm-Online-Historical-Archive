# Frequently Asked Questions (FAQ)

## 🕰️ Timezones & Temporal Integrity

### How does the archive handle logs from different players in different timezones?
The archive employs a **Universal Anchor & Context Preservation** strategy:

1.  **Universal Anchor (UTC):** All system metadata (ingestion dates, record creation) is stored in **UTC (GMT 0)**. This provides a single, immutable global timeline for the archive's internal operations.
2.  **Context Preservation:** Wurm Online logs are generated using the player's local system time. To preserve the historical context of these timestamps, we capture the **Archaeologist's (Contributor's) Timezone** during the upload process. This acts as a metadata tag for future researchers.
3.  **Adaptive Visualization:** When browsing the archive, the interface automatically translates data density and activity maps to your **local browser time**. This ensures that "peak activity" is viewed relative to your own experience.
4.  **Archival Integrity:** During "Bulk Restore" (merging multiple files), we preserve the original raw text. We group data by day (`Logging started YYYY-MM-DD`) but maintain the original `[HH:MM:SS]` timestamps to ensure the historical record remains uncorrupted by modern interpretation.

## 🛡️ Privacy & Security

### Are my private messages (PMs) archived?
The current system identifies and categorizes logs by type. While the infrastructure is designed to handle various logs, the primary mission is the preservation of **world-level history** (Trade, Village, Global chats). Private logs are handled with the same immutability, but future interpretation layers will prioritize public historical records.

### Can I delete a contribution?
In line with our **Archival Philosophy**, contributions are immutable. Once a fragment is part of the ledger, it cannot be modified or deleted. This ensures the archive cannot be used as a tool for historical revisionism or surveillance evasion.

## 📂 Data & Storage

### How do you handle duplicate logs?
We use **SHA-256 Hashing** on the client-side. Before any data is sent to our servers, the browser calculates a unique fingerprint of the file. If that fingerprint already exists in the archive, the contribution is acknowledged but not duplicated, preserving storage and ensuring data purity.
