.PHONY: help up init-hdfs down reset logs ps status \
        bulk crypto transform load demo monitor test clean ui

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
	@echo "  make transform       Silver: HDFS Bronze JSON -> HDFS Silver Parquet"
	@echo "  make load            Gold: HDFS Silver -> Postgres KPIs"
	@echo "  make demo            up + init-hdfs + bulk + crypto + transform + load"
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
	$(COMPOSE) exec -T namenode hdfs dfs -mkdir -p /data/bronze/crypto_news
	$(COMPOSE) exec -T namenode hdfs dfs -mkdir -p /data/silver
	$(COMPOSE) exec -T namenode hdfs dfs -mkdir -p /data/gold
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

transform:
	$(COMPOSE) exec -T $(SPARK_SERVICE) \
		spark-submit --master spark://spark-master:7077 --deploy-mode client \
		/opt/spark/jobs/silver_transform.py --date $$(date -u +%Y-%m-%d)

load:
	$(COMPOSE) exec -T $(SPARK_SERVICE) \
		spark-submit --master spark://spark-master:7077 --deploy-mode client \
		--packages org.postgresql:postgresql:42.7.3 \
		/opt/spark/jobs/gold_kpis.py

demo: up init-hdfs bulk crypto transform load
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
