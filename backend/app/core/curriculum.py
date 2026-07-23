"""
AI 学科课程体系 — 章节与知识点映射。

用于出题助手、智能备课等模块的章节/知识点下拉建议。
每门课程包含多个章节，每章包含若干核心知识点。
"""

CURRICULUM: dict[str, list[dict]] = {
    "机器学习": [
        {
            "chapter": "绪论与基础",
            "knowledge_points": [
                "机器学习的定义与分类", "监督学习", "无监督学习", "半监督学习",
                "强化学习", "训练集/验证集/测试集", "偏差与方差",
                "过拟合与欠拟合", "正则化", "交叉验证",
                "特征工程", "特征选择", "特征提取",
            ],
        },
        {
            "chapter": "线性模型",
            "knowledge_points": [
                "线性回归", "最小二乘法", "梯度下降",
                "随机梯度下降(SGD)", "批量梯度下降", "小批量梯度下降",
                "逻辑回归", "Softmax回归", "L1/L2正则化",
                "Ridge回归", "Lasso回归", "弹性网",
            ],
        },
        {
            "chapter": "决策树与集成学习",
            "knowledge_points": [
                "决策树", "ID3算法", "C4.5算法", "CART算法",
                "信息增益", "信息增益比", "基尼指数",
                "剪枝策略", "预剪枝", "后剪枝",
                "随机森林", "Bagging", "Boosting",
                "AdaBoost", "GBDT", "XGBoost", "LightGBM",
                "Stacking", "Blending",
            ],
        },
        {
            "chapter": "支持向量机",
            "knowledge_points": [
                "SVM原理", "最大间隔分类器", "支持向量",
                "核函数", "线性核", "多项式核", "RBF核",
                "软间隔", "松弛变量", "KKT条件",
                "SMO算法", "SVR支持向量回归",
            ],
        },
        {
            "chapter": "贝叶斯分类器",
            "knowledge_points": [
                "贝叶斯定理", "朴素贝叶斯", "高斯朴素贝叶斯",
                "多项式朴素贝叶斯", "半朴素贝叶斯", "贝叶斯网络",
                "EM算法", "极大似然估计", "最大后验估计",
            ],
        },
        {
            "chapter": "聚类分析",
            "knowledge_points": [
                "K-Means", "K-Means++", "层次聚类",
                "DBSCAN", "均值漂移", "高斯混合模型(GMM)",
                "谱聚类", "轮廓系数", "Calinski-Harabasz指标",
                "聚类评估", "肘部法则",
            ],
        },
        {
            "chapter": "降维与特征学习",
            "knowledge_points": [
                "PCA主成分分析", "SVD奇异值分解",
                "LDA线性判别分析", "t-SNE", "UMAP",
                "因子分析", "独立成分分析(ICA)", "流形学习",
            ],
        },
    ],
    "深度学习": [
        {
            "chapter": "神经网络基础",
            "knowledge_points": [
                "感知机", "多层感知机(MLP)", "激活函数",
                "Sigmoid", "Tanh", "ReLU", "LeakyReLU",
                "前向传播", "反向传播(BP)", "链式法则",
                "损失函数", "MSE", "交叉熵", "Hinge Loss",
                "优化器", "SGD", "Momentum", "Adam", "RMSprop",
            ],
        },
        {
            "chapter": "卷积神经网络(CNN)",
            "knowledge_points": [
                "卷积层", "卷积核", "步长", "填充",
                "池化层", "最大池化", "平均池化",
                "全连接层", "Dropout", "Batch Normalization",
                "LeNet", "AlexNet", "VGGNet",
                "GoogLeNet/Inception", "ResNet", "DenseNet",
                "MobileNet", "EfficientNet",
            ],
        },
        {
            "chapter": "循环神经网络(RNN)",
            "knowledge_points": [
                "RNN原理", "BPTT", "梯度消失/爆炸",
                "LSTM", "遗忘门", "输入门", "输出门",
                "GRU", "双向RNN", "深度RNN",
                "Seq2Seq", "编码器-解码器",
            ],
        },
        {
            "chapter": "注意力机制与Transformer",
            "knowledge_points": [
                "注意力机制", "自注意力(Self-Attention)",
                "多头注意力(Multi-Head Attention)",
                "Transformer架构", "位置编码",
                "Layer Normalization", "残差连接",
                "BERT", "GPT系列", "ViT",
                "Cross-Attention", "Sparse Attention",
            ],
        },
        {
            "chapter": "生成模型",
            "knowledge_points": [
                "GAN", "生成器", "判别器",
                "DCGAN", "CGAN", "WGAN",
                "VAE变分自编码器", "扩散模型(DDPM)",
                "Stable Diffusion", "Score-based模型",
                "Flow-based模型",
            ],
        },
        {
            "chapter": "深度学习训练技巧",
            "knowledge_points": [
                "学习率调度", "Warmup", "余弦退火",
                "数据增强", "迁移学习", "微调(Fine-tuning)",
                "知识蒸馏", "模型剪枝", "量化",
                "混合精度训练", "分布式训练",
            ],
        },
    ],
    "自然语言处理": [
        {
            "chapter": "文本预处理与表示",
            "knowledge_points": [
                "分词", "中文分词(jieba)", "词性标注",
                "去停用词", "词袋模型(BoW)", "TF-IDF",
                "Word2Vec", "CBOW", "Skip-gram",
                "GloVe", "FastText", "负采样",
            ],
        },
        {
            "chapter": "语言模型",
            "knowledge_points": [
                "N-gram语言模型", "困惑度(Perplexity)",
                "神经语言模型", "RNN语言模型",
                "GPT系列预训练", "BERT预训练(Masked LM)",
                "NSP任务", "大语言模型(LLM)",
                "Prompt Engineering", "In-Context Learning",
            ],
        },
        {
            "chapter": "序列标注",
            "knowledge_points": [
                "命名实体识别(NER)", "HMM隐马尔可夫模型",
                "CRF条件随机场", "BiLSTM-CRF",
                "词性标注(POS Tagging)", "中文NER",
            ],
        },
        {
            "chapter": "文本分类与情感分析",
            "knowledge_points": [
                "文本分类流程", "TextCNN", "TextRNN",
                "FastText分类", "BERT微调分类",
                "情感分析", "多标签分类", "层次分类",
                "评价指标", "F1-Score", "混淆矩阵",
            ],
        },
        {
            "chapter": "信息抽取与知识图谱",
            "knowledge_points": [
                "关系抽取", "事件抽取", "实体链接",
                "知识图谱构建", "RDF/OWL", "Neo4j",
                "TransE", "知识图谱推理",
            ],
        },
        {
            "chapter": "机器翻译与对话系统",
            "knowledge_points": [
                "统计机器翻译(SMT)", "神经机器翻译(NMT)",
                "Seq2Seq翻译", "注意力翻译模型",
                "BLEU评分", "任务型对话", "闲聊对话",
                "RAG检索增强生成",
            ],
        },
    ],
    "数据挖掘": [
        {
            "chapter": "数据挖掘导论",
            "knowledge_points": [
                "数据挖掘的定义与流程", "KDD过程", "CRISP-DM方法论",
                "数据仓库与OLAP", "数据立方体", "数据预处理",
                "数据清洗", "数据集成", "数据变换", "数据规约",
                "特征构造", "特征离散化", "采样技术",
            ],
        },
        {
            "chapter": "关联规则挖掘",
            "knowledge_points": [
                "频繁项集", "Apriori算法", "FP-Growth算法",
                "关联规则", "支持度", "置信度", "提升度",
                "闭合频繁项集", "极大频繁项集",
                "多层关联规则", "多维关联规则",
                "序列模式挖掘", "GSP算法", "PrefixSpan",
            ],
        },
        {
            "chapter": "分类与预测",
            "knowledge_points": [
                "分类问题定义", "决策树分类(ID3/C4.5/CART)",
                "朴素贝叶斯分类", "KNN最近邻分类",
                "逻辑回归分类", "支持向量机(SVM)",
                "集成分类方法", "随机森林", "AdaBoost",
                "模型评估", "混淆矩阵", "ROC曲线", "AUC",
                "交叉验证", "过拟合处理", "类别不平衡处理",
            ],
        },
        {
            "chapter": "聚类分析",
            "knowledge_points": [
                "聚类分析概述", "相似性度量", "欧氏距离", "余弦相似度",
                "划分聚类", "K-Means", "K-Medoids(PAM)",
                "层次聚类", "AGNES", "DIANA",
                "密度聚类", "DBSCAN", "OPTICS",
                "模型聚类", "高斯混合模型(GMM)", "EM聚类",
                "聚类评估", "轮廓系数", "CH指标", "DBI指数",
            ],
        },
        {
            "chapter": "离群点检测",
            "knowledge_points": [
                "离群点定义与类型", "统计方法", "Z-Score",
                "箱线图法(IQR)", "基于距离的方法",
                "基于密度的方法", "LOF局部离群因子",
                "基于聚类的方法", "孤立森林(Isolation Forest)",
                "One-Class SVM", "高维数据离群检测",
            ],
        },
        {
            "chapter": "推荐系统",
            "knowledge_points": [
                "协同过滤", "基于用户的CF", "基于物品的CF",
                "矩阵分解", "SVD", "FunkSVD", "ALS交替最小二乘",
                "基于内容的推荐", "混合推荐",
                "冷启动问题", "实时推荐", "排序学习(Learning to Rank)",
                "推荐系统评估", "Precision@K", "Recall@K", "NDCG",
            ],
        },
        {
            "chapter": "文本与Web挖掘",
            "knowledge_points": [
                "文本预处理", "TF-IDF", "向量空间模型(VSM)",
                "主题模型", "LDA", "PLSA",
                "情感分析", "观点挖掘", "文本分类",
                "网页排序", "PageRank", "HITS算法",
                "链接分析", "社交网络分析", "社区发现",
            ],
        },
    ],
    "AI智能体": [
        {
            "chapter": "智能体基础理论",
            "knowledge_points": [
                "智能体(Agent)定义与分类", "理性智能体", "PEAS模型",
                "环境特性(可观察/确定/静态等)", "反应式智能体",
                "基于模型的智能体", "目标驱动智能体", "效用驱动智能体",
                "学习型智能体", "BDI模型(信念-愿望-意图)",
                "单智能体 vs 多智能体系统",
            ],
        },
        {
            "chapter": "大语言模型与智能体",
            "knowledge_points": [
                "LLM Agent架构", "ReAct框架(推理+行动)",
                "Tool Use / Function Calling", "工具调用机制",
                "Planning能力", "任务分解(Decomposition)",
                "反思机制(Reflection)", "自我纠错(Self-Correction)",
                "记忆系统(短期/长期/工作记忆)", "上下文窗口管理",
                "Chain-of-Thought(CoT)", "Tree-of-Thought(ToT)",
            ],
        },
        {
            "chapter": "多智能体系统(MAS)",
            "knowledge_points": [
                "多智能体协作", "智能体通信协议", "ACL/FIPA",
                "任务分配与调度", "合同网协议", "拍卖机制",
                "分布式问题求解", "博弈论基础", "纳什均衡",
                "多智能体强化学习(MARL)", "集中式训练分散执行(CTDE)",
                "MADDPG", "QMIX", "涌现行为",
            ],
        },
        {
            "chapter": "RAG与知识增强",
            "knowledge_points": [
                "RAG基础架构", "检索-增强-生成流水线",
                "向量数据库(Milvus/Pinecone/Weaviate)",
                "文档分块策略", "Embedding模型选型",
                "Query重写与优化", "HyDE假设文档嵌入",
                "多路召回", "重排序(Rerank)",
                "Self-RAG", "CRAG", "GraphRAG", "Agentic RAG",
            ],
        },
        {
            "chapter": "Agent框架与开发实践",
            "knowledge_points": [
                "LangChain核心组件", "LangGraph状态图",
                "AutoGPT", "MetaGPT", "CrewAI多智能体框架",
                "AutoGen对话式智能体", "Semantic Kernel",
                "Dify低代码Agent平台", "Coze/扣子平台",
                "Agent应用场景", "代码助手", "数据分析Agent",
                "Agent安全", "Prompt注入防护", "权限控制",
            ],
        },
        {
            "chapter": "智能体评测与部署",
            "knowledge_points": [
                "Agent评测维度", "任务完成率", "工具调用准确率",
                "AgentBench基准", "SWE-Bench编程评测",
                "幻觉检测", "忠实度评估",
                "Agent部署架构", "API服务化", "流式输出(SSE)",
                "可观测性", "LangSmith", "LangFuse追踪",
                "成本控制", "Token优化", "缓存策略",
            ],
        },
    ],
    "计算机视觉": [
        {
            "chapter": "图像基础与预处理",
            "knowledge_points": [
                "图像表示", "色彩空间(RGB/HSV/Lab)",
                "灰度化", "直方图均衡化",
                "图像滤波", "高斯滤波", "中值滤波",
                "边缘检测", "Sobel", "Canny",
                "霍夫变换", "形态学操作",
            ],
        },
        {
            "chapter": "图像分类与识别",
            "knowledge_points": [
                "CNN图像分类", "AlexNet", "VGG",
                "ResNet", "EfficientNet",
                "迁移学习", "ImageNet预训练",
                "细粒度分类", "零样本分类",
            ],
        },
        {
            "chapter": "目标检测",
            "knowledge_points": [
                "R-CNN", "Fast R-CNN", "Faster R-CNN",
                "YOLO系列", "SSD", "Anchor机制",
                "NMS非极大值抑制", "mAP评价指标",
                "FPN特征金字塔", "DETR",
            ],
        },
        {
            "chapter": "图像分割",
            "knowledge_points": [
                "语义分割", "FCN全卷积网络",
                "U-Net", "DeepLab系列",
                "实例分割", "Mask R-CNN",
                "全景分割", "IoU评价指标",
                "Dice系数",
            ],
        },
        {
            "chapter": "视频分析与生成",
            "knowledge_points": [
                "光流法", "目标跟踪", "行为识别",
                "3D卷积", "时序动作检测",
                "视频生成", "NeRF", "3D重建",
                "多模态学习", "CLIP",
            ],
        },
    ],
}


def get_course_list() -> list[str]:
    """获取所有课程名称。"""
    return list(CURRICULUM.keys())


def get_chapters(course: str) -> list[str]:
    """获取指定课程的所有章节。"""
    entries = CURRICULUM.get(course, [])
    return [entry["chapter"] for entry in entries]


def get_knowledge_points(course: str, chapter: str = "") -> list[str]:
    """
    获取知识点列表。
    - 如果指定 chapter，返回该章的知识点
    - 如果 chapter 为空，返回该课程所有章节的知识点合集
    """
    entries = CURRICULUM.get(course, [])
    if chapter:
        for entry in entries:
            if entry["chapter"] == chapter:
                return entry["knowledge_points"]
        return []

    all_kps: list[str] = []
    for entry in entries:
        all_kps.extend(entry["knowledge_points"])
    return all_kps
