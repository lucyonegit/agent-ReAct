import { z } from 'zod';
import { ToolDefinition } from '../../types/index.js';

// 搜索输入的Zod schema
const SearchInputSchema = z.object({
  query: z.string().describe('Search query string'),
  maxResults: z.number().min(1).max(20).default(5).describe('Maximum number of results to return'),
  category: z.enum(['web', 'news', 'images', 'videos']).default('web').describe('Search category')
});

/**
 * 搜索工具 - 模拟网络搜索功能
 * 注意：这是一个mock实现，实际使用时应该连接真实的搜索API
 */
export const SearchTool: ToolDefinition = {
  name: 'search',
  description: 'Searches the internet for information on a given topic. Returns relevant results with titles, descriptions, and URLs.',
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search query string (e.g., "artificial intelligence", "weather in Beijing")',
      required: true,
      schema: z.string().min(1)
    },
    {
      name: 'maxResults',
      type: 'number',
      description: 'Maximum number of results to return (1-20, default: 5)',
      required: false,
      schema: z.number().min(1).max(20)
    },
    {
      name: 'category',
      type: 'string',
      description: 'Search category: "web", "news", "images", or "videos"',
      required: false,
      schema: z.enum(['web', 'news', 'images', 'videos'])
    }
  ],
  execute: async (input: any) => {
    try {
      const { query, maxResults, category } = SearchInputSchema.parse(input);
      
      // 模拟搜索延迟
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 生成模拟搜索结果
      const results = generateMockSearchResults(query, maxResults, category);
      
      return {
        query,
        category,
        totalResults: results.length,
        results,
        searchTime: '0.5 seconds',
        timestamp: new Date().toISOString(),
        source: 'Mock Search Engine'
      };
    } catch (error) {
      throw new Error(`Search error: ${error instanceof Error ? error.message : 'Invalid search parameters'}`);
    }
  }
};

/**
 * 生成模拟搜索结果
 */
function generateMockSearchResults(query: string, maxResults: number, category: string) {
  const results = [];
  
  // 根据查询生成相关的模拟结果
  const queryLower = query.toLowerCase();
  
  for (let i = 0; i < maxResults; i++) {
    const result = generateSingleResult(queryLower, i + 1, category);
    results.push(result);
  }
  
  return results;
}

/**
 * 生成单个搜索结果
 */
function generateSingleResult(query: string, index: number, category: string) {
  const baseResult = {
    rank: index,
    relevanceScore: Math.round((1 - (index - 1) * 0.1) * 100) / 100,
    category
  };

  // 根据查询内容生成相关标题和描述
  const { title, description, url } = generateContentByQuery(query, index);

  return {
    ...baseResult,
    title,
    description,
    url,
    publishDate: generateRandomDate(),
    domain: extractDomain(url),
    snippet: description.substring(0, 150) + (description.length > 150 ? '...' : '')
  };
}

/**
 * 根据查询生成相关内容
 */
function generateContentByQuery(query: string, index: number) {
  // 预定义的主题模板
  const topicTemplates: Record<string, any> = {
    'artificial intelligence': {
      titles: [
        'What is Artificial Intelligence? A Comprehensive Guide',
        'AI Applications in Modern Technology',
        'Machine Learning vs Artificial Intelligence',
        'The Future of AI: Trends and Predictions',
        'AI Ethics and Responsible Development'
      ],
      descriptions: [
        'Artificial Intelligence (AI) refers to the simulation of human intelligence in machines that are programmed to think and learn like humans.',
        'Explore the various applications of AI in healthcare, finance, transportation, and other industries.',
        'Understanding the differences between machine learning, deep learning, and artificial intelligence.',
        'Discover the latest trends in AI development and what the future holds for artificial intelligence.',
        'Learn about the ethical considerations and responsible practices in AI development and deployment.'
      ],
      domains: ['wikipedia.org', 'mit.edu', 'stanford.edu', 'openai.com', 'deepmind.com']
    },
    'weather': {
      titles: [
        'Current Weather Conditions and Forecast',
        'Weather Patterns and Climate Change',
        'How Weather Prediction Works',
        'Extreme Weather Events and Safety',
        'Weather Apps and Tools'
      ],
      descriptions: [
        'Get accurate weather forecasts, current conditions, and severe weather alerts for your location.',
        'Understanding how climate change affects global weather patterns and local conditions.',
        'Learn about meteorology and the science behind weather prediction and forecasting.',
        'Stay safe during extreme weather events with preparation tips and emergency procedures.',
        'Compare the best weather apps and tools for accurate forecasting and weather tracking.'
      ],
      domains: ['weather.com', 'noaa.gov', 'accuweather.com', 'weatherunderground.com', 'bbc.com']
    },
    'programming': {
      titles: [
        'Learn Programming: A Beginner\'s Guide',
        'Best Programming Languages in 2024',
        'Software Development Best Practices',
        'Open Source Programming Projects',
        'Programming Interview Preparation'
      ],
      descriptions: [
        'Start your programming journey with this comprehensive guide covering basics to advanced concepts.',
        'Discover the most popular and in-demand programming languages for different career paths.',
        'Learn industry best practices for writing clean, maintainable, and efficient code.',
        'Contribute to open source projects and build your programming portfolio.',
        'Prepare for technical interviews with coding challenges and algorithm practice.'
      ],
      domains: ['github.com', 'stackoverflow.com', 'codecademy.com', 'freecodecamp.org', 'leetcode.com']
    }
  };

  // 查找匹配的主题
  let matchedTopic = null;
  for (const [topic, template] of Object.entries(topicTemplates)) {
    if (query.includes(topic) || topic.includes(query)) {
      matchedTopic = template;
      break;
    }
  }

  // 如果没有匹配的主题，生成通用结果
  if (!matchedTopic) {
    return {
      title: `${capitalizeFirst(query)} - Search Result ${index}`,
      description: `This is a search result about ${query}. It contains relevant information and resources related to your query.`,
      url: `https://example${index}.com/${query.replace(/\\s+/g, '-')}`
    };
  }

  // 使用匹配的主题模板
  const titleIndex = (index - 1) % matchedTopic.titles.length;
  const descIndex = (index - 1) % matchedTopic.descriptions.length;
  const domainIndex = (index - 1) % matchedTopic.domains.length;

  return {
    title: matchedTopic.titles[titleIndex],
    description: matchedTopic.descriptions[descIndex],
    url: `https://${matchedTopic.domains[domainIndex]}/${query.replace(/\\s+/g, '-')}-${index}`
  };
}

/**
 * 生成随机日期
 */
function generateRandomDate(): string {
  const now = new Date();
  const daysAgo = Math.floor(Math.random() * 365);
  const randomDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return randomDate.toISOString().split('T')[0];
}

/**
 * 从URL提取域名
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'example.com';
  }
}

/**
 * 首字母大写
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}