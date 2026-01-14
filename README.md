<div align="center">

<img src="logo.png" alt="Webverse" width="400"/>

***

*The collaborative canvas to annotate the web*

</div>

## What is Webverse?

Webverse lets you draw collaboratively on any website in real-time. Annotate webpages, share ideas, and see what others are drawing, right in your browser.

### How it Works

Every webpage gets its own shared canvas. Your drawings are linked to the page's URL, so when you revisit a page, you'll see all the annotations you and others have made there.

### Getting Started

**1. Login**

Click the Webverse extension icon and log in with your Google or GitHub account. This is required so the app can:

- Identify your drawings
- Let you see annotations across your devices
- Enable real-time collaboration with other users

**2. Open the Drawing Toolbar**

After logging in, click "Launch Webverse" in the popup. A floating toolbar will appear on the current page, giving you access to all drawing tools.

**3. Start Drawing**

With the toolbar open, you can:
- **Draw freehand lines** in any color and width
- **Use the eraser** to remove parts of your drawings
- **Undo** your strokes (and then redo)

All your drawings appear instantly to other users viewing the same page, and you'll see theirs in real-time too.

### Understanding Layers

The toolbar has three layer modes:

**Public Layer** 🌍
- Your drawings are visible to everyone
- You can see drawings from all users
- Default layer for open collaboration

**Mine Layer** 👤
- Only shows your own public drawings
- Filter out the noise and focus on your annotations
- Still visible to others (just filtered to show only yours)

**Private Layer** 🔒
- Only you can see them
- Drawings are encrypted end-to-end
- Perfect for personal notes and sensitive annotations

### Private Layer Setup

To use the Private layer, you first need to set a password in the extension popup. This password is used to derive an encryption key to encrypt your private drawings. Each time you draw on the Private layer, your annotations are encrypted with this key before they leave your device.

The encryption happens locally on your device. Our servers never see your private drawings or password. They only store encrypted data that only you can decrypt. In fact, even the URLs of private drawings are encrypted, so we don't even know which pages you have private annotations on.

**Locking and Unlocking**

Once you've enabled the Private layer, it will stay unlocked while your browser is open. When you close and reopen your browser, you'll need to unlock it again by entering your password.

You can also manually lock the Private layer at any time by clicking "Lock Private Layer" in the popup. To unlock it again, simply enter the same password you used to enable it.

**Forgot Your Password?**

If you forget your Private layer password, you can reset it by clicking "Forgot Password?" in the unlock screen. However, resetting your password will permanently delete all of your existing Private layer drawings. We can't decrypt them without your original password.

**Changing Your Password**

When your Private layer is unlocked, you can change your password by clicking "Change Private Layer Password" in the popup. This will derive a new encryption key and re-encrypt all of your existing Private layer drawings with the new password. Your drawings are preserved because your current encryption key is still in memory.

**Disabling Private Layer**

You can permanently disable the Private layer and delete all of your private drawings by clicking "Disable Private Layer" in the popup's Danger Zone section. This will remove your password and delete all encrypted Private layer data from our servers. This action cannot be undone.

### Deleting Your Account

You can delete your entire account at any time from the extension popup. Scroll down to the "Danger Zone" section and click "Delete Account". This will:

- Immediately remove your account data from our servers
- Delete all of your public annotations
- Delete all of your encrypted Private layer data

The deletion process typically completes instantly, but may take a couple of minutes to remove all of your public annotations if you have a very large number of drawings. This action cannot be undone.

---

## Ideas for Future Enhancements

Here are some potential ideas we're considering for future Webverse enhancements:

**1. Group Layers & Private Groups**
- Create invite-only groups for private collaboration
- Share annotations with specific people while keeping them private from the public
- Team and enterprise use cases

**2. More Drawing Tools**
- Text annotations
- Shapes (rectangles, circles, arrows)
- Highlighter tool
- Image/sticker support

**3. Real-Time Stroke Streaming**
- Stream annotations as they're being drawn instead of waiting for stroke completion
- See other users' drawings in real-time as they create them
- More fluid collaborative experience

**4. Firefox Support**
- Currently available on Chromium-based browsers (Chrome, Brave, Edge, Opera)
- Potential support for Firefox with its WebExtensions API

**5. Element-Anchored Annotations**
- Anchor annotations to page elements instead of fixed pixel positions
- Annotations stay in place even when page layouts change
- Better handling of responsive and dynamic web pages

**6. Content Moderation**
- Report button for harmful content
- Admin dashboard for reviewing reports
- Content removal capabilities
- Community guidelines enforcement

**7. Protocol Buffers (Protobuf)**
- Replace JSON with Protobuf for WebSocket messages
- Reduce network bandwidth and improve performance
- Faster serialization/deserialization of annotation data

Have an idea you'd like to see implemented? Contributions are welcome!

---

## Encryption Technical Details

**Key Setup**

When you enable the Private layer, we generate:

- **DEK1** (Data Encryption Key 1): A random 256-bit key for encrypting drawing content
- **DEK2** (Data Encryption Key 2): A random 256-bit key for creating page identifiers
- **Salt**: A random 128-bit value for key derivation

Your password is combined with the salt to derive a 256-bit **KEK** (Key Encryption Key) using Argon2id with these parameters:
- Parallelism: 1
- Memory: 64 MB
- Iterations: 3

The KEK encrypts both DEK1 and DEK2. We then send the encrypted DEK1, encrypted DEK2, and the salt to our server for storage. The unencrypted DEK1 and DEK2 are never stored on disk. They are only kept in memory using `chrome.storage.session`, which is cleared when your browser closes.

**Encrypting Drawings**

When you create a Private layer drawing:

1. **Generate a nonce**: A random 192-bit value for this specific drawing
2. **Encrypt the content**: Using XChaCha20-Poly1305 with DEK1 and the nonce, we encrypt:
   - Drawing tool type
   - Color and width
   - Start position
   - Delta positions (all the points in your stroke)
3. **Hash the page URL**: Using HMAC-SHA256 with DEK2, we create an opaque page identifier from the URL. This ensures consistent page keys without revealing which pages you've annotated.
4. **Store**: The encrypted content, nonce, and HMAC page key are sent to the server for storage

**Changing Your Password**

When you change your password while unlocked:

1. Generate a new random 128-bit salt
2. Derive a new KEK from your new password + new salt (Argon2id)
3. Re-encrypt DEK1 and DEK2 with the new KEK
4. Send the new salt and re-encrypted DEKs to the server

Your existing drawings don't need to be re-encrypted because DEK1 and DEK2 haven't changed. We're just changing how they're protected.

**Forgetting Your Password**

When you reset a forgotten password:

1. Generate fresh new DEK1 and DEK2 (completely new keys)
2. Delete all existing Private layer drawings (they're now undecryptable garbage)
3. Start fresh with the new keys

We can't recover your old drawings because DEK1 and DEK2 were encrypted with your old password's KEK, and there's no way to decrypt them without the original password.

**Cryptographic Libraries**

We use the well-tested and audited Noble libraries for all cryptographic operations:

- [@noble/ciphers](https://www.npmjs.com/package/@noble/ciphers) - XChaCha20-Poly1305 encryption
- [@noble/hashes](https://www.npmjs.com/package/@noble/hashes) - Argon2id key derivation and HMAC-SHA256

**Source Code and Tests**

The encryption implementation is in the [`extension/background/encryption/`](extension/background/encryption/) folder. You can run the encryption tests with:

```bash
cd extension
npm run test -- background/encryption
```

> **Note**: These tests take about a minute to run due to the intentional computational overhead of Argon2id (designed to be memory-hard and slow to prevent brute-force attacks).

---

## For Developers

### Local Development

#### Prerequisites

- **Backend**: Go 1.25+, Docker and Docker Compose
- **Frontend**: Node.js 20.19+ and npm

#### Environment Configuration

**1. Create Environment Files**

```bash
# Backend environment
cp backend/.env.template backend/.env

# Frontend environment
cp extension/.env.template extension/.env.dev
```

**2. Generate Chrome Extension Key**

Generate a 2048-bit RSA key pair and derive your extension ID:

```bash
KEY=$(openssl genrsa 2048 2>/dev/null) && echo && echo "VITE_MANIFEST_KEY=$(echo "$KEY" | openssl rsa -pubout -outform DER 2>/dev/null | base64 -w 0)" && echo && echo "EXTENSION_ID=$(echo "$KEY" | openssl rsa -pubout -outform DER 2>/dev/null | sha256sum | cut -c1-32 | tr '0-9a-f' 'a-p')" && unset KEY
```

This outputs:
```
VITE_MANIFEST_KEY=your-generated-key-here

EXTENSION_ID=abcdefghijklmnopqrstuvwxyz
```

Add the manifest key to `extension/.env.dev` and the extension ID to `backend/.env`:

> **Note**: The private key is discarded after outputting the manifest (public) key and extension ID. You don't need it for development or production. The public key in the manifest is only used to ensure a consistent extension ID during development.

```bash
# In extension/.env.dev:
VITE_MANIFEST_KEY=your-chrome-manifest-key

# In backend/.env:
EXTENSION_ID=your-extension-id
```

> **Why this matters**: The manifest key ensures your extension has a consistent ID in Chrome during development. This ID is used for OAuth redirect URIs and the host header in WebSocket connections.

**3. Create OAuth Apps**

Create OAuth applications on Google and GitHub:

**Google Cloud Console:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Navigate to APIs & Services → Credentials
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI: `https://<your-extension-id>.chromiumapp.org`

**GitHub Developer Settings:**
1. Go to GitHub → Settings → [Developer settings](https://github.com/settings/developers) → OAuth Apps
2. Register a new OAuth application
3. Set Authorization callback URL: `https://<your-extension-id>.chromiumapp.org`

**4. Add OAuth Credentials to Both Environment Files**

Add the OAuth credentials to **both** `backend/.env` and `extension/.env.dev`:

```bash
# For backend/.env:
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# For extension/.env.dev:
VITE_GOOGLE_CLIENT_ID=your-google-client-id
VITE_GITHUB_CLIENT_ID=your-github-client-id
```

**5. Generate JWT Secret**

Generate a secure random JWT secret and add it to `backend/.env`:

```bash
# Generate JWT secret
head -c 32 /dev/urandom | base64
```

Add the output to `backend/.env`:

```bash
JWT_SECRET=your-jwt-secret
```

#### Backend Setup

**1. Download Go Dependencies**

```bash
cd backend/app
go mod download
```

**2. Run Tests**

Test the Go backend:

```bash
cd backend/app
go test ./service/tests
```

For verbose output:

```bash
go test -v ./service/tests
```

For coverage:

```bash
# Run tests with coverage report
go test -coverprofile=coverage.out -covermode=atomic -coverpkg=./service ./service/tests

# View coverage as HTML (opens in browser)
go tool cover -html=coverage.out

# View coverage by function
go tool cover -func=coverage.out | sort -t: -k3 -rn
```

**3. Start Docker Compose**

The backend runs in Docker containers with hot-reload enabled:

```bash
cd backend
docker compose up --build
```

The `--build` flag builds the Docker images (required first time and whenever Go dependencies change). Subsequent starts can omit `--build` if nothing has changed.

This starts:
- Go application (with live reload on code changes)
- Redis (caching)
- DynamoDB Local (database)
- ElasticMQ (AWS SQS-compatible message queue)

The backend will be available at `http://localhost:8080`. You can change the port by modifying `HOST_PORT` in `backend/.env`.

#### Frontend Setup

**1. Install Dependencies**

```bash
cd extension
npm install
```

**2. Run Tests**

Run the test suite to verify everything works:

```bash
npm run test
```

For a visual test UI:

```bash
npm run test:ui
```

**3. Build Extension**

```bash
npm run build
```

This builds all extension targets to the `extension/dist/` folder.

**4. Load in Chrome**

1. Open your Chromium-based browser
2. Navigate to `chrome://extensions`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `extension/dist/` folder

Your extension is now loaded! When you make changes to the frontend code:

```bash
npm run build
```

Then go to `chrome://extensions` and click the reload button on your extension.

### Production Deployment (AWS)

#### Prerequisites

- **Docker** - For building the backend Docker image
- **AWS CLI v2** - For deploying infrastructure and managing AWS resources
- **AWS Credentials** - Configure with `aws configure` using AWS Access Key ID and Secret Access Key with permissions for:
  - SSM Parameter Store (read/write)
  - ECR (read/write)
  - ECS (update services - for redeployments)

#### Deployment Steps

**1. Create Production Environment Files**

```bash
# Backend production environment
cp backend/.env.template backend/.env.prod

# Frontend production environment
cp extension/.env.template extension/.env.prod
```

**Remove unnecessary variables from production configs:**

For `extension/.env.prod` - remove `VITE_MANIFEST_KEY`

For `backend/.env.prod` - remove `DEV_MODE`, `HOST_PORT`, `DYNAMODB_ENDPOINT`, `SQS_ENDPOINT`, `REDIS_ENDPOINT`

**2. Create Production OAuth and JWT Credentials**

Generate fresh OAuth apps and JWT secret for production (do NOT reuse development credentials):

- Create new OAuth 2.0 credentials in [Google Cloud Console](https://console.cloud.google.com/)
- Create new OAuth application in [GitHub Developer Settings](https://github.com/settings/developers)
- Generate a new JWT secret: `head -c 32 /dev/urandom | base64`

Add the production credentials to **both** `backend/.env.prod` and `extension/.env.prod`:

```bash
# For backend/.env.prod:
EXTENSION_ID=your-prod-extension-id
GOOGLE_CLIENT_ID=your-prod-google-client-id
GOOGLE_CLIENT_SECRET=your-prod-google-client-secret
GITHUB_CLIENT_ID=your-prod-github-client-id
GITHUB_CLIENT_SECRET=your-prod-github-client-secret
JWT_SECRET=your-prod-jwt-secret

# For extension/.env.prod:
VITE_GOOGLE_CLIENT_ID=your-prod-google-client-id
VITE_GITHUB_CLIENT_ID=your-prod-github-client-id
```

**3. Configure Production API Domain**

Choose a domain or subdomain for your production backend API (e.g., `api.yourdomain.com`).

Add it to `extension/.env.prod`:

```bash
VITE_API_BASE_URL=https://your-prod-domain.com
```

**4. Build Chrome Extension for Production**

```bash
cd extension
npm run build:prod
```

**5. Pack Extension**

In Chrome (or Chromium-based browser):

1. Navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Pack extension"
4. Select the `extension/dist/` folder
5. This generates `dist.crx` and `dist.pem`

**6. Add to Chrome Web Store**

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Click "New Item"
3. Upload `dist.crx` (as of January 2026, you may need to rename it to `dist.zip` for upload)
4. Save as a draft

**7. Get Production Extension ID**

In the Chrome Web Store Developer Dashboard, navigate to your extension's draft page. The extension ID will be visible (generated by Chrome, stays constant).

Add it to `backend/.env.prod`:

```bash
EXTENSION_ID=your-chrome-web-store-extension-id
```

> **Tip**: On the "Package Information" page of your draft item, you can also view the public key. Copy this public key and replace the `VITE_MANIFEST_KEY` in `extension/.env.dev` with it. This ensures your local development builds have the same extension ID as the production store version, making it easier to test with the same backend and OAuth credentials.

**8. Create TLS Certificate**

In AWS Certificate Manager (ACM) in the region you'll deploy:

1. Go to AWS Certificate Manager
2. Request a public certificate for your domain
3. Choose DNS validation
4. Add the CNAME records to your DNS provider to prove ownership
5. Wait for certificate validation (usually minutes)

Take note of the certificate ARN for a later step.

**9. Export Environment and Deploy Docker Image**

```bash
cd backend
./deploy-aws.sh --region <your-region> --push-ecr --export-env
```

This builds the backend Docker image, pushes it to ECR, and exports your `.env.prod` values to AWS SSM Parameter Store.

> **Note**: Once infrastructure is running, subsequent deployments can also use `--redeploy-ecs`:
> ```bash
> ./deploy-aws.sh --region <your-region> --push-ecr --redeploy-ecs
> ```
> This pushes the latest Docker image to ECR and forces ECS to start new tasks with the updated image.

**10. Deploy CloudFormation Stack**

1. Go to AWS CloudFormation in the target region
2. Click "Create stack" → "With new resources"
3. Upload `backend/webverse-stack.yml`
4. Stack name: `webverse-infrastructure`
5. Required parameter: ACM Certificate ARN (from step 8)
6. Click "Create stack"

Wait for stack creation to complete. The Outputs section will show the ALB DNS name.

**11. Configure DNS**

Add a DNS record to point your domain to the Application Load Balancer:

- **Subdomain** (e.g., `api.yourdomain.com`): Add a CNAME record pointing to the ALB DNS name
- **Root domain** (e.g., `yourdomain.com`):
  - AWS Route 53: Use an Alias record to the ALB
  - Cloudflare: Use a CNAME Flatten record

**12. Submit Chrome Web Store Extension**

Once DNS is configured and the backend is accessible:

1. Go back to your extension draft in Chrome Web Store Developer Dashboard
2. Verify all information is complete
3. Click "Submit for review"
4. Wait for Google approval (typically a few days)

Your production deployment is now live!

### AWS Architecture

Webverse runs on AWS in a multi-AZ, single-region architecture designed for high availability, security, and scalability.

#### Compute Layer

**ECS Fargate**
- The Go application runs as containerized tasks on AWS Fargate (serverless containers)
- Auto-scales based on CPU load with a minimum of 2 tasks for redundancy
- Tasks run in private subnets and are accessed via an Application Load Balancer
- Container images are stored in Amazon ECR (Elastic Container Registry)

**Application Load Balancer**
- Public-facing ALB distributes traffic across ECS tasks in multiple Availability Zones
- Terminates TLS/SSL connections using certificates from AWS Certificate Manager
- Has health checks to route traffic only to healthy ECS tasks
- Protected by AWS WAF for additional security layer

#### Networking

**VPC Structure**
- **Private subnets**: Host ECS tasks and ElastiCache nodes (no direct internet access)
- **Public subnets**: Host the Application Load Balancer
- **Regional NAT Gateway**: Enables outbound internet access for ECS tasks (required for OAuth API calls to Google and GitHub)
- **VPC Gateway Endpoint**: Private access to DynamoDB without internet gateway or NAT

**Security Groups**
- Separate security groups for ECS, ElastiCache, and ALB
- Each security group has minimum required permissions (principle of least privilege)
- ECS tasks can only connect to ElastiCache, DynamoDB (via gateway endpoint), and outbound HTTPS via NAT (for SQS, SSM and Oauth)

#### Data Layer

**DynamoDB**
- Primary database for all persistent data (users, strokes, pages)
- Accessed privately via VPC gateway endpoint (no NAT costs, no internet exposure)
- Uses on-demand capacity mode for automatic scaling
- Single table design with Global Secondary Indexes for efficient queries

**ElastiCache Serverless (Valkey)**
- Redis-compatible caching and pub/sub layer
- Stores active page subscriptions for WebSocket broadcasts
- Caches recently accessed strokes and page data to reduce DynamoDB load
- Runs in private subnets, isolated from the internet
- Serverless mode automatically scales based on demand

**SQS (Simple Queue Service)**
- Message queue for asynchronous operations (e.g., user account deletion with all strokes)
- Decouples time-consuming operations from WebSocket request handling
- Accessed by ECS via NAT gateway

#### Configuration & Secrets

**SSM Parameter Store**
- Stores all environment variables for the ECS tasks
- OAuth client secrets and JWT secret use `SecureString` type (encrypted with AWS KMS)
- Non-sensitive configuration uses standard `String` type
- ECS tasks fetch parameters on startup via NAT gateway

#### Architecture Diagram

```
Internet
   ↓
AWS WAF (Web Application Firewall)
   ↓
Application Load Balancer (Public Subnets)
   ↓
ECS Fargate Tasks (Private Subnets)
   ↓
   ├─→ DynamoDB (VPC Gateway Endpoint - Private)
   ├─→ ElastiCache Serverless Valkey (Private Subnets)
   ├─→ SQS (via NAT Gateway)
   ├─→ SSM Parameter Store (via NAT Gateway)
   └─→ Oauth APIs (via NAT Gateway)
```

This architecture provides:
- **High Availability**: Multi-AZ deployment with auto-scaling
- **Security**: Private subnets, security groups, least privilege access, encrypted secrets
- **Scalability**: Auto-scaling ECS and ElastiCache Serverless handle varying load

### Security & Anti-Abuse Measures

Webverse implements multiple layers of protection to prevent abuse and ensure fair usage:

#### Authentication & Authorization

**WebSocket Authentication**
- Users receive a week-long JWT upon login
- All WebSocket connections must include a valid JWT from a logged-in user in the headers
- Connections without valid authentication are immediately terminated
- Implemented in: [`app/api/ws_handler.go`](backend/app/api/ws_handler.go)
- JWT issuance in: [`app/service/auth.go`](backend/app/service/auth.go)

#### Connection Limits

**Per-User Connection Limits**
- Maximum 3 simultaneous WebSocket connections per user per backend instance
- Allows users to be connected on up to 3 browsers/computers simultaneously
- Prevents a single user from monopolizing server resources
- Implemented in: [`app/api/ws_hub.go`](backend/app/api/ws_hub.go)

**Single WebSocket per Browser**
- The extension uses a single WebSocket connection in the background service worker
- This connection is shared across all tabs and windows of the browser
- Efficient resource usage with automatic multiplexing

#### Usage Limits

**Page Subscriptions**
- Maximum 50 page subscriptions per WebSocket connection
- Prevents overwhelming the Redis pub/sub system
- Users can receive live updates from up to 50 pages simultaneously
- Implemented in: [`app/api/ws_hub.go`](backend/app/api/ws_hub.go)

**Message Size Limits**
- Maximum WebSocket message size: 16 KB
- Implemented in: [`app/api/ws_client.go`](backend/app/api/ws_client.go)
- Frontend automatically splits strokes at 1,000 points to ensure messages fit within limits
- Prevents individual messages from overwhelming the server

**Rate Limiting**
- 10 WebSocket messages per second per connection
- Burst allowance: 50 messages
- Connections exceeding limits are automatically closed
- Prevents spam and message flooding attacks
- Implemented in: [`app/api/ws_client.go`](backend/app/api/ws_client.go)

#### Stroke Limits

**Per-Page Limits**
- Maximum 1,000 strokes per page
- Prevents individual pages from becoming too large to load
- Ensures reasonable performance for users viewing pages with many annotations
- Implemented in: [`app/service/drawing.go`](backend/app/service/drawing.go)

**Per-User Limits**
- Maximum 100,000 strokes per user across all pages
- Prevents database abuse and excessive storage costs
- Encourages users to be thoughtful about their annotations
- Implemented in: [`app/service/drawing.go`](backend/app/service/drawing.go)

#### Network-Level Protection

**Web Application Firewall (WAF)**
- AWS WAF Web ACL limits: 100 requests per 60 seconds per IP
- Applied at the infrastructure level in [`webverse-stack.yml`](backend/webverse-stack.yml)
- Most traffic flows through WebSocket (counts as 1 connection), so this limit is generous for legitimate use
- Protects against HTTP floods and brute force attacks

#### Defense in Depth

These measures work together to provide defense in depth:
1. **Authentication** ensures only legitimate users can connect
2. **Connection limits** prevent resource monopolization
3. **Rate limiting** prevents message flooding
4. **Size limits** prevent message-based abuse
5. **Stroke limits** prevent data abuse
6. **WAF** provides network-level protection against attacks

This multi-layered approach ensures Webverse remains responsive and available for all users while preventing abuse.

---

## License

Webverse is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

See [`LICENSE`](LICENSE) for the full license text.