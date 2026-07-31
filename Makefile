.PHONY: help up init-hdfs down reset logs ps status \
        bulk crypto crypto-live spark-deps transform load demo monitor test clean ui

COMPOSE = docker compose
SPARK_SERVICE = spark-master

help:
	@echo "BigDataProject Makefile"
	@echo ""
	@echo "Cluster:"
	@echo "  make up              Start all services (background)"
	@echo "  make down            Stop services, keep volumes"
	@echo "  make reset           Stop services, drop volumes (full clean)"
	@echo "  make logs            Tail all service logs"
	@echo "  make ps              Show service status"
	@echo "  make status          Same as ps"
	@echo ""
	@echo "Data:"
	@echo "  make init-hdfs       Create /data/{bronze,silver,gold} directories on HDFS"
	@echo "  make bulk            Stocks + ETF OHLCV archives -> HDFS Bronze"
	@echo "  make crypto          Crypto OHLCV + news headlines -> HDFS Bronze"
	@echo "  make crypto-live     CoinGecko live API OHLC -> HDFS Bronze (cron-friendly)"
	@echo "  make transform       Silver: HDFS Bronze JSON -> HDFS Silver Parquet"
	@echo "  make load            Gold: HDFS Silver -> Postgres KPIs"
	@echo "  make demo            up + init-hdfs + bulk + crypto + crypto-live + transform + load"
	@echo ""
	@echo "Monitoring:"
	@echo "  make monitor         Print Grafana + Prometheus URLs"
	@echo ""
	@echo "Tests:"
	@echo "  make test            Run pytest smoke tests"
	@echo ""
	@echo "Maintenance:"
	@echo "  make clean           Same as reset"
	@echo ""
	@echo "Dashboard:"
	@echo "  make ui              Start Next.js dashboard on http://localhost:3001"

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

reset: down
	$(COMPOSE) down -v

logs:
	$(COMPOSE) logs -f --tail=100

ps status:
	$(COMPOSE) ps

init-hdfs:
	@echo "Creating HDFS directories..."
	$(COMPOSE) exec -T namenode hdfs dfs -mkdir -p /data/bronze/stocks
	$(COMPOSE) exec -T namenode hdfs dfs -mkdir -p /data/bronze/crypto_bulk
	$(COMPOSE) exec -T namenode hdfs dfs -mkdir -p /data/bronze/crypto_live
	$(COMPOSE) exec -T namenode hdfs dfs -mkdir -p /data/bronze/crypto_news
	$(COMPOSE) exec -T namenode hdfs dfs -mkdir -p /data/silver
	$(COMPOSE) exec -T namenode hdfs dfs -mkdir -p /data/gold
	@# Bronze is written as root (via the namenode container) but Spark runs as
	@# the `spark` user, so it cannot write Silver without this. Single-node dev
	@# cluster with no auth — do not copy this to a shared deployment.
	$(COMPOSE) exec -T namenode hdfs dfs -chmod -R 777 /data
	@echo "Done."

# STOCKS_DIR / ETFS_DIR hold the *.us.txt OHLCV files from the Kaggle archive.
STOCKS_DIR ?= data/Stocks
ETFS_DIR   ?= data/ETFs
CRYPTO_DIR ?= data

bulk:
	@if [ ! -d "$(STOCKS_DIR)" ]; then \
		echo "ERROR: $(STOCKS_DIR) not found."; \
		echo "Download and extract: https://www.kaggle.com/datasets/borismarjanovic/price-volume-data-for-all-us-stocks-etfs"; \
		echo "Override the location with: make bulk STOCKS_DIR=... ETFS_DIR=..."; \
		exit 1; \
	fi
	python scripts/fetch_stocks.py --folder $(STOCKS_DIR) --folder $(ETFS_DIR)

crypto:
	python scripts/fetch_crypto.py --folder $(CRYPTO_DIR)

# Live API feed (CoinGecko, no key). Safe to run from cron.
crypto-live:
	python scripts/fetch_crypto_live.py --days $(LIVE_DAYS)

LIVE_DAYS ?= 90

# The apache/spark image ships no third-party Python packages, and the Silver
# job needs datasketch for MinHash/LSH. Installed into the running containers
# rather than baked into an image, so it must be re-applied after `make reset`.
spark-deps:
	@for svc in spark-master spark-worker; do \
		$(COMPOSE) exec -T -u 0 $$svc pip install -q datasketch || exit 1; \
	done
	@echo "Spark Python deps installed."

transform: spark-deps
	$(COMPOSE) exec -T $(SPARK_SERVICE) \
		/opt/spark/bin/spark-submit --master spark://spark-master:7077 --deploy-mode client \
		/opt/spark/jobs/silver_transform.py --date $$(date -u +%Y-%m-%d)

# The Gold job writes over JDBC. `--packages` needs Maven Central at runtime and
# a writable Ivy cache, neither of which the apache/spark image reliably has, so
# vendor the driver next to the jobs (jobs/ is already mounted into the cluster).
PG_JAR = postgresql-42.7.3.jar
PG_JAR_URL = https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.3/$(PG_JAR)

jobs/$(PG_JAR):
	@echo "Downloading $(PG_JAR)..."
	curl -fsSL -o jobs/$(PG_JAR) $(PG_JAR_URL)

load: jobs/$(PG_JAR)
	$(COMPOSE) exec -T $(SPARK_SERVICE) \
		/opt/spark/bin/spark-submit --master spark://spark-master:7077 --deploy-mode client \
		--jars /opt/spark/jobs/$(PG_JAR) \
		--driver-class-path /opt/spark/jobs/$(PG_JAR) \
		/opt/spark/jobs/gold_kpis.py

demo: up init-hdfs bulk crypto crypto-live transform load
	@echo ""
	@echo "=== Demo complete ==="
	@echo "Grafana:    http://localhost:3000 (admin / admin)"
	@echo "Prometheus: http://localhost:9090"
	@echo "HDFS UI:    http://localhost:9870"
	@echo "Spark UI:   http://localhost:8088"
	@echo "cAdvisor:   http://localhost:8081"
	@echo "Postgres:   localhost:5432 (gold / gold / gold)"

monitor:
	@echo "Grafana:    http://localhost:3000"
	@echo "Prometheus: http://localhost:9090"
	@echo "cAdvisor:   http://localhost:8081"

test:
	pytest tests/ -v

clean: reset

ui:
	@echo "Starting Next.js dashboard on http://localhost:3001"
	@echo "(Ctrl+C to stop)"
	cd dashboard && npm run dev
