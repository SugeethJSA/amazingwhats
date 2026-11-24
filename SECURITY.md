# Security Policy

## 🔐 Reporting Security Vulnerabilities

If you discover a security vulnerability in **amazingwhats**, please report it **privately and responsibly**.

**Do NOT open a public GitHub issue** for security-related problems.

### How to Report

Please report security issues by:
- Opening a **private GitHub security advisory**, or
- Contacting the maintainer directly (if contact information is provided in the repository)

When reporting, please include:
- A clear description of the issue
- Steps to reproduce (if applicable)
- Potential impact
- Any relevant logs, stack traces, or proof-of-concept details

We will acknowledge receipt of your report as soon as possible and work towards a fix.

---

## ⏱️ Response Expectations

- **Acknowledgement:** within a reasonable time
- **Assessment:** severity and impact evaluation
- **Fix:** coordinated patch or mitigation
- **Disclosure:** public disclosure only after a fix is available

We ask reporters to allow reasonable time for investigation and remediation before public disclosure.

---

## 🧠 Security Scope

### In Scope
- WhatsApp protocol handling via `whatsmeow`
- Message synchronization and storage
- Media handling and caching
- IPC between frontend and backend
- Authentication state handling
- Local data storage and permissions

### Out of Scope
- Vulnerabilities in WhatsApp or Meta infrastructure
- Account bans or restrictions imposed by WhatsApp
- Issues caused by modified or unofficial WhatsApp servers
- Problems introduced by third-party forks or downstream builds

---

## 🔒 Data & Privacy Considerations

- amazingwhats does **not** collect analytics or telemetry
- All user data is stored **locally**
- Encryption and protocol handling rely on the upstream `whatsmeow` library
- Sensitive information should never be logged or exposed

Contributors must take care to:
- Avoid logging message contents, keys, or identifiers unnecessarily
- Avoid weakening cryptographic or protocol-related code
- Follow the principle of least privilege

---

## 🛑 Known Limitations

- amazingwhats is an **unofficial client**
- Use of unofficial clients may violate WhatsApp’s Terms of Service
- Account restrictions or bans are possible and are outside the project’s control

Users are advised to use the software at their own discretion.

---

## 🤝 Responsible Disclosure

We value and encourage responsible disclosure.  
Security researchers who follow this policy will be credited where appropriate (with their consent).

---

Thank you for helping keep amazingwhats secure.
