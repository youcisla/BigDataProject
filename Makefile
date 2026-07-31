.PHONY: help build up init-hdfs down reset logs ps status \
        bulk crypto crypto-live news intraday ingest transform load demo monitor test lint clean ui

COMPOSE = docker compose
SPARK_SERVICE = spark-master

help:
	@echo "BigDataProject Makefile"
	@echo ""
	@echo "Cluster:"
	@echo "  make build           Build the Spark image (datasketch, VADER, JDBC driver)"
	@echo "  make up              Start all services (background)"
	@echo "  make down            Stop services, keep volumes"
	@echo "  make reset           Stop services, drop volumes (full clean)"
	@echo "  make logs            Tail all service logs"
	@echo "  make ps / status     Show service status"
	@echo ""
	@echo "Ingestion (Bronze):"
	@echo "  make init-hdfs       Create /data/{bronze,silver,gold} on HDFS"
	@echo "  make bulk            Stocks + ETF OHLCV archives      (~16.5M records)"
	@echo "  make crypto          Crypto OHLCV + bundled headlines (archive)"
	@echo "  make crypto-live     CoinGecko live OHLC              (free API, cron-friendly)"
	@echo "  make news            Financial news RSS + sentiment   (free feeds, cron-friendly)"
	@echo "  make intraday        Sub-daily bars 1m/5m/15m/1h      (Yahoo chart API)"
	@echo "  make ingest          All five Bronze sources"
	@echo ""
	@echo "Pipeline:"
	@echo "  make transform       Silver: Bronze JSON -> Parquet (dedup + schema)"
	@echo "  make load            Gold: Silver -> Postgres KPIs (+ VADER sentiment)"
	@echo "  make demo            up + init-hdfs + ingest + transform + load"
	@echo ""
	@echo "Monitoring:"
	@echo "  make monitor         Print Grafana + Prometheus URLs"
	@echo ""
	@echo "Quality:"
	@echo "  make test            pytest smoke tests (Bronze/Silver/Gold)"
	@echo "  make lint            TypeScript typecheck for the dashboard"
	@echo ""
	@echo "Dashboard:"
	@echo "  make ui              Next.js dashboard on http://localhost:3001"

# ---------------------------------------------------------------- cluster ---

build:
	$(COMPOSE) build spark-master spark-worker

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
	$(COMPOSE) exec -T namenode hdfs dfs -mkdir -p /data/bronze/news_rss
	$(COMPOSE) exec -T namenode hdfs dfs -mkdir -p /data/bronze/intraday
	$(COMPOSE) exec -T namenode hdfs dfs -mkdir -p /data/silver
	$(COMPOSE) exec -T namenode hdfs dfs -mkdir -p /data/gold
	@# Bronze is written as root (via the namenode container) but Spark runs as
	@# the `spark` user, so it cannot write Silver without this. Single-node dev
	@# cluster with no auth — do not copy this to a shared deployment.
	$(COMPOSE) exec -T namenode hdfs dfs -chmod -R 777 /data
	@echo "Done."

# -------------------------------------------------------------- ingestion ---

# STOCKS_DIR / ETFS_DIR hold the *.us.txt OHLCV files from the Kaggle archive.
STOCKS_DIR ?= data/Stocks
ETFS_DIR   ?= data/ETFs
CRYPTO_DIR ?= data
LIVE_DAYS  ?= 90
# How many of the best-covered Gold tickers get a per-symbol news feed.
NEWS_TICKERS ?= 40

bulk:
	@if test ! -d "$(STOCKS_DIR)"; then \
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

# Free financial news RSS (Yahoo Finance per symbol, CoinDesk, CoinTelegraph,
# Nasdaq). No API key. Safe to run from cron — headlines dedup in Silver.
news:
	python scripts/fetch_news_rss.py --from-gold $(NEWS_TICKERS)

# Sub-daily bars. The Kaggle archive is daily-only, so the chart's 1m/5m/15m/1h
# timeframes come from here. Yahoo caps history per interval: 1m ~7d, 5m/15m
# ~60d, 1h ~730d — asking for more silently returns less.
INTRADAY_TICKERS ?= BTC,ETH,AAPL,MSFT,GOOGL,AMZN,TSLA,NVDA,SOL,ADA
INTRADAY_INTERVALS ?= 1m,5m,15m,1h

intraday:
	python scripts/fetch_intraday.py --tickers $(INTRADAY_TICKERS) --intervals $(INTRADAY_INTERVALS)

ingest: bulk crypto crypto-live news intraday

# --------------------------------------------------------------- pipeline ---

transform:
	$(COMPOSE) exec -T $(SPARK_SERVICE) \
		sh -c "/opt/spark/bin/spark-submit --master spark://spark-master:7077 --deploy-mode client /opt/spark/jobs/silver_transform.py --date \"\$$(date -u +%Y-%m-%d)\""

# datasketch, vaderSentiment, and the Postgres JDBC driver are baked into the
# image by docker/spark/Dockerfile, so no --packages and no pip install here.
load:
	$(COMPOSE) exec -T $(SPARK_SERVICE) \
		/opt/spark/bin/spark-submit --master spark://spark-master:7077 --deploy-mode client \
		/opt/spark/jobs/gold_kpis.py

demo: build up init-hdfs ingest transform load
	@echo ""
	@echo "=== Demo complete ==="
	@echo "Dashboard:  http://localhost:3001   (make ui)"
	@echo "Grafana:    http://localhost:3000   (admin / admin)"
	@echo "Prometheus: http://localhost:9090"
	@echo "HDFS UI:    http://localhost:9870"
	@echo "Spark UI:   http://localhost:8088"
	@echo "cAdvisor:   http://localhost:8081"
	@echo "Postgres:   localhost:5432 (gold / gold / gold)"

# ------------------------------------------------------------------ misc ----

monitor:
	@echo "Grafana:    http://localhost:3000"
	@echo "Prometheus: http://localhost:9090"
	@echo "cAdvisor:   http://localhost:8081"
	@echo "Pushgateway: http://localhost:9091"

test:
	pytest tests/ -v

lint:
	cd dashboard && npx tsc --noEmit

clean: reset

ui:
	@echo "Starting Next.js dashboard on http://localhost:3001"
	@echo "(Ctrl+C to stop)"
	cd dashboard && npm run dev
