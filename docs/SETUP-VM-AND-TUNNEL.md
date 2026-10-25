# Setting up Infinity-One on an Oracle free VM with Cloudflare Tunnel

Doc ID: DOC-INF-SETUP-001 · v1.0.0 · 2026-10-25

This guide takes you from nothing to a working sign-in at `https://portal.trancendos.com`
and `https://gate.trancendos.com`, without changing `auth.trancendos.com` yet. The switch of
`auth.trancendos.com` is a separate, later step (see [DNS-CUTOVER.md](DNS-CUTOVER.md)), done only
after everything below works.

What it costs: nothing, if you stay inside Oracle's Always Free limits and Cloudflare's free plan.
Every piece of software used is free and open source (see [DEPENDENCY-TRACKER.md](DEPENDENCY-TRACKER.md)).

Time needed: about an hour, most of it waiting for Oracle.

---

## Part 1. Create the VM (Oracle Cloud, Always Free)

1. Go to <https://signup.cloud.oracle.com> and create an account. Oracle asks for a card to prove
   you are a person. Always Free resources are not charged. Pick a **home region** close to you
   (for example UK South (London)). You cannot change the home region later.
2. In the Oracle console open **Compute > Instances > Create instance**.
3. Name it `infinity-one`.
4. **Image and shape > Edit**:
   - Image: **Canonical Ubuntu 24.04**.
   - Shape: **Ampere > VM.Standard.A1.Flex**, 2 OCPUs and 12 GB memory is plenty
     (Always Free allows up to 4 OCPUs and 24 GB in total).
   - If Oracle says "out of capacity", try another availability domain, or try again later.
     This is common and is not something you did wrong.
5. **Networking**: keep the default new VCN and public subnet. Leave "assign a public IPv4 address" on;
   you need it only for SSH. No web ports will be opened.
6. **Add SSH keys**: choose "Generate a key pair for me" and **download the private key**. Keep it safe.
7. Click **Create**. Wait until the instance shows **Running**, then copy its **Public IP address**.

Honest warning: Oracle may reclaim Always Free instances that sit almost idle for 7 days
(CPU, network and memory all very low). A sign-in service is light, so this can happen.
Two free ways to avoid it: upgrade the account to "Pay As You Go" (Always Free resources stay
free; you are only billed if you create paid resources), or keep a backup (Part 6) so you can
recreate the VM in minutes.

## Part 2. Connect and install Docker

From Windows PowerShell (replace the key path and IP):

```powershell
ssh -i C:\path\to\ssh-key.key ubuntu@<PUBLIC_IP>
```

Then on the VM:

```bash
sudo apt-get update && sudo apt-get -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
sudo apt-get -y install git unattended-upgrades
exit
```

Reconnect with the same `ssh` command so the docker group applies, then check:

```bash
docker run --rm hello-world
```

## Part 3. Get the code and make secrets

```bash
sudo mkdir -p /opt/infinity-one && sudo chown ubuntu:ubuntu /opt/infinity-one
git clone https://github.com/Trancendos/Infinity-One.git /opt/infinity-one
cd /opt/infinity-one/deploy
sh scripts/gen-secrets.sh        # writes deploy/.env with fresh random secrets, mode 600
```

The repository is private, so `git clone` asks for your GitHub username and a personal access
token (GitHub > Settings > Developer settings > Fine-grained tokens, read-only access to
Infinity-One is enough).

## Part 4. Start the stack (without the tunnel yet)

```bash
cd /opt/infinity-one/deploy
docker compose up -d --build
docker compose ps                 # postgres healthy, hydra-migrate exited 0, the rest Up
sh scripts/register-clients.sh    # creates the Gate and Management Center OAuth clients
```

Create your own admin account (you will be asked for a password, minimum 12 characters):

```bash
docker compose exec one node cli.js create-user --email you@example.com --name "Drew" --admin
```

Quick checks from the VM itself:

```bash
curl -s -H 'X-Forwarded-Proto: https' http://127.0.0.1:4444/.well-known/openid-configuration | head -c 200; echo
curl -s http://127.0.0.1:8042/healthz; echo
curl -s http://127.0.0.1:8046/healthz; echo
```

You should see the issuer `https://auth.trancendos.com` and two `{"ok":true,...}` lines.
Nothing is reachable from the internet yet: every port is bound to 127.0.0.1.

## Part 5. Connect the Cloudflare Tunnel

You already have a tunnel named **TranceLinkHub** that has never connected. You can reuse it.

1. Open <https://one.dash.cloudflare.com> > **Networks > Tunnels**.
2. Click **TranceLinkHub > Configure**. (Or **Create a tunnel > Cloudflared** named `infinity-one`.)
3. Under **Install and run a connector**, pick **Docker**. Copy only the long token after `--token`.
4. On the VM, put it in `.env`:
   ```bash
   cd /opt/infinity-one/deploy
   nano .env        # set CLOUDFLARE_TUNNEL_TOKEN=<the token>, save with Ctrl+O, exit with Ctrl+X
   docker compose --profile tunnel up -d
   docker compose logs cloudflared | tail -5     # look for "Registered tunnel connection"
   ```
   The tunnel page in Cloudflare should now show the connector as **Healthy**.
5. In the tunnel, open **Public Hostname > Add a public hostname**, and add these two
   (they are new names, so nothing existing changes):

   | Subdomain | Domain | Type | URL |
   |---|---|---|---|
   | `portal` | trancendos.com | HTTP | `portal:8042` |
   | `gate` | trancendos.com | HTTP | `gate:8046` |

   Do **not** add `auth` yet. `auth.trancendos.com` still points at the old worker, and the
   switch is the separate step in [DNS-CUTOVER.md](DNS-CUTOVER.md).

6. Test from your PC: open <https://portal.trancendos.com/healthz> and
   <https://gate.trancendos.com/healthz>. Both should show `"ok":true`.

At this point sign-in will not complete yet, because the browser must reach Hydra at
`auth.trancendos.com`. That is expected. Tell Claude "the VM answers" and the DNS cutover
will be confirmed with you record by record.

## Part 6. Keep it healthy

- **Backups**: `crontab -e` and add
  `15 3 * * * sh /opt/infinity-one/deploy/scripts/backup.sh >> /opt/infinity-one/deploy/backups/backup.log 2>&1`.
  Copy `deploy/backups/` off the VM now and then (for example to the Trancendos drive folder).
  The script keeps 14 days on the VM.
- **Security updates**: `unattended-upgrades` (installed in Part 2) patches Ubuntu automatically.
- **Updating Infinity-One**: `cd /opt/infinity-one && git pull && cd deploy && docker compose up -d --build`.
- **Image updates**: versions are pinned in `docker-compose.yml`. Check [DEPENDENCY-TRACKER.md](DEPENDENCY-TRACKER.md)
  monthly, bump a tag, then `docker compose pull && docker compose up -d`.
- **Logs**: `docker compose logs -f portal` (or hydra, gate, one). The One directory also keeps
  an audit trail of every sign-in and change: `docker compose exec one tail -n 50 /data/audit.log`.

## Managing people

```bash
cd /opt/infinity-one/deploy
docker compose exec one node cli.js list
docker compose exec one node cli.js locations
docker compose exec one node cli.js create-user --email someone@example.com --name "Someone"
docker compose exec one node cli.js set-right --email someone@example.com --location townhall --level user
docker compose exec one node cli.js set-password --email someone@example.com
docker compose exec one node cli.js disable --email someone@example.com
```

Levels are `viewer`, `user`, `admin`, or `none` to remove. Management Center only opens for `admin`.
