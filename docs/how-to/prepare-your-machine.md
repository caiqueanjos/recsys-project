# Prepare a machine for the learning path

Use this guide before building the lab or running this repository. Install only the tools needed for your next lesson. Commands in these docs use a POSIX shell: bash/zsh on Linux or macOS, or a Linux terminal in WSL2 on Windows. Bronze uses POSIX file locking, so use that same Linux environment for its Python commands.

## Before lesson 1: Node and a working directory

Install **Node 24**, including npm, using the [official Node download instructions](https://nodejs.org/en/download). Select the 24.x release rather than assuming the newest release matches the project. Open a new terminal after installation.

```sh
node --version
npm --version
```

Expect Node `v24.x` and an npm version. You also need an editor, a browser, and a directory where you can create files. Network access is needed for npm packages. You do not need Python, Docker, or this repository to start the lab. If you clone the reference project later, install Git using [its installation guide](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git).

## Before lesson 4: Docker and Compose

Follow [Docker's platform installation guide](https://docs.docker.com/get-started/get-docker/). Docker Desktop includes Compose; Linux Engine installations should also install the [Compose plugin](https://docs.docker.com/compose/install/linux/). On Windows, enable Docker's WSL2 integration for the Linux distribution where you keep the lab.

Start Docker, then check both the client and running engine:

```sh
docker version
docker compose version
```

Expect both Client and Server details from `docker version`, and a Compose version. A client version with an engine connection error is not a successful preflight. The lab uses PostgreSQL port 5434; this repository uses 5432. Keep them separate. Pulling the first database image needs network access.

## Before lesson 7: uv, Python, and Java

Install uv using [its official instructions](https://docs.astral.sh/uv/getting-started/installation/). Install a **JDK 17 or 21** using [Eclipse Temurin's platform instructions](https://adoptium.net/installation/). A JDK is the Java runtime/development installation used by Spark; installing Python alone does not supply it.

```sh
uv --version
uv python install 3.12
uv run --python 3.12 python --version
java -version
```

Expect Python 3.12 and Java 17 or 21. If another Java version is selected, set `JAVA_HOME` to the installed JDK directory and prepend its `bin` directory to `PATH`, following the installation instructions for your platform. Open a new terminal if the installer changed your shell environment.

Spark's first run downloads Maven jars and opens local JVM sockets. The exercise needs a writable local filesystem and network access. Its uv environment lives in the lab's `tools/bronze`; do not install its dependencies into a recommendation project. Do not proceed past a failed preflight: the [troubleshooting guide](troubleshoot.md) distinguishes setup failures from application failures.

## Before repository browser regression checks

From the cloned repository after `npm ci`, run `npx playwright install --with-deps chromium`. Linux system-library installation may require administrator access. This is optional for manually following the lab in your own browser.

Related: [tutorial 1](../tutorials/01-workspace-and-api.md), [workspace reference](../reference/workspace.md), [index](../README.md).
