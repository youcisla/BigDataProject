.PHONY: help up init-hdfs down reset logs ps status \
        bulk ingest-news transform load demo monitor test clean ui

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
	@echo "  make bulk            Reddit bulk dump (REDDIT_BULK_PATH) -> HDFS Bronze"
	@echo "  make ingest-news     NewsAPI headlines -> HDFS Bronze"
	@echo "  make transform       Silver: HDFS Bronze JSON -> HDFS Silver Parquet"
	@echo "  make load            Gold: HDFS Silver -> Postgres KPIs"
	@echo "  make demo            up + init-hdfs + bulk + transform + load"
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
	$(COMPOSE) exec -T -e HADOOP_CONF_DIR=/opt/hadoop/etc/hadoop namenode hdfs dfs -mkdir -p /data/bronze/reddit
	$(COMPOSE) exec -T -e HADOOP_CONF_DIR=/opt/hadoop/etc/hadoop namenode hdfs dfs -mkdir -p /data/bronze/news
	$(COMPOSE) exec -T -e HADOOP_CONF_DIR=/opt/hadoop/etc/hadoop namenode hdfs dfs -mkdir -p /data/silver
	$(COMPOSE) exec -T -e HADOOP_CONF_DIR=/opt/hadoop/etc/hadoop namenode hdfs dfs -mkdir -p /data/gold
	@echo "Done."

bulk:
	@if [ -z "$$REDDIT_BULK_PATH" ]; then \
		echo "ERROR: REDDIT_BULK_PATH env var not set. Point it to a Reddit CSV/ZST dump."; \
		exit 1; \
	fi
	@echo "Loading Reddit dump from $$REDDIT_BULK_PATH ..."
	REDDIT_BULK_PATH=$$REDDIT_BULK_PATH python scripts/fetch_reddit.py

ingest-news:
	python scripts/fetch_newsapi.py

transform:
	$(COMPOSE) exec -T -e HADOOP_CONF_DIR=/opt/hadoop/etc/hadoop $(SPARK_SERVICE) \
		spark-submit --master spark://spark-master:7077 --deploy-mode client \
		/opt/spark/jobs/silver_transform.py --date $$(date -u +%Y-%m-%d)

load:
	$(COMPOSE) exec -T -e HADOOP_CONF_DIR=/opt/hadoop/etc/hadoop $(SPARK_SERVICE) \
		spark-submit --master spark://spark-master:7077 --deploy-mode client \
		--packages org.postgresql:postgresql:42.7.3 \
		/opt/spark/jobs/gold_kpis.py

demo: up init-hdfs bulk transform load
	@echo ""
	@echo "=== Demo complete ==="
	@echo "Grafana:    http://localhost:3000 (admin / admin)"
	@echo "Prometheus: http://localhost:9090"
	@echo "HDFS UI:    http://localhost:9870"
	@echo "Spark UI:   http://localhost:8080"
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
