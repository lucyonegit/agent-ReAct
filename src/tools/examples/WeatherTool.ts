import { z } from 'zod';
import { ToolDefinition } from '../../types/index.js';

// 天气查询输入的Zod schema
const WeatherInputSchema = z.object({
  location: z.string().describe('City name or location to get weather for'),
  unit: z.enum(['celsius', 'fahrenheit']).default('celsius').describe('Temperature unit')
});

/**
 * 天气工具 - 模拟天气查询功能
 * 注意：这是一个mock实现，实际使用时应该连接真实的天气API
 */
export const WeatherTool: ToolDefinition = {
  name: 'weather',
  description: 'Gets current weather information for a specified location. Returns temperature, conditions, humidity, and wind speed.',
  parameters: [
    {
      name: 'location',
      type: 'string',
      description: 'City name or location to get weather for (e.g., "Beijing", "New York", "London")',
      required: true,
      schema: z.string().min(1)
    },
    {
      name: 'unit',
      type: 'string',
      description: 'Temperature unit: "celsius" or "fahrenheit"',
      required: false,
      schema: z.enum(['celsius', 'fahrenheit'])
    }
  ],
  execute: async (input: any) => {
    try {
      const { location, unit } = WeatherInputSchema.parse(input);
      
      // Mock天气数据生成
      const weatherData = generateMockWeatherData(location, unit);
      
      return {
        location,
        unit,
        ...weatherData,
        timestamp: new Date().toISOString(),
        source: 'Mock Weather Service'
      };
    } catch (error) {
      throw new Error(`Weather query error: ${error instanceof Error ? error.message : 'Invalid input'}`);
    }
  }
};

/**
 * 生成模拟天气数据
 */
function generateMockWeatherData(location: string, unit: 'celsius' | 'fahrenheit') {
  // 预定义一些城市的基础温度（摄氏度）
  const baseCityTemperatures: Record<string, number> = {
    'beijing': 15,
    'shanghai': 20,
    'guangzhou': 25,
    'shenzhen': 26,
    'new york': 12,
    'london': 8,
    'paris': 10,
    'tokyo': 18,
    'sydney': 22,
    'moscow': -5,
    'dubai': 35,
    'singapore': 30
  };

  const locationLower = location.toLowerCase();
  let baseTemp = baseCityTemperatures[locationLower] || 20; // 默认20度

  // 添加随机变化 (-5 到 +5 度)
  const randomVariation = (Math.random() - 0.5) * 10;
  let temperature = Math.round((baseTemp + randomVariation) * 10) / 10;

  // 转换温度单位
  if (unit === 'fahrenheit') {
    temperature = Math.round((temperature * 9/5 + 32) * 10) / 10;
  }

  // 生成其他天气数据
  const conditions = getRandomWeatherCondition(temperature, unit);
  const humidity = Math.floor(Math.random() * 40) + 30; // 30-70%
  const windSpeed = Math.floor(Math.random() * 20) + 5; // 5-25 km/h
  const pressure = Math.floor(Math.random() * 50) + 1000; // 1000-1050 hPa

  return {
    temperature,
    temperatureUnit: unit,
    condition: conditions.condition,
    description: conditions.description,
    humidity: `${humidity}%`,
    windSpeed: `${windSpeed} km/h`,
    pressure: `${pressure} hPa`,
    visibility: `${Math.floor(Math.random() * 5) + 10} km`,
    uvIndex: Math.floor(Math.random() * 11), // 0-10
    feelsLike: unit === 'celsius' 
      ? Math.round((temperature + (Math.random() - 0.5) * 4) * 10) / 10
      : Math.round((temperature + (Math.random() - 0.5) * 7) * 10) / 10
  };
}

/**
 * 根据温度生成随机天气状况
 */
function getRandomWeatherCondition(temperature: number, unit: 'celsius' | 'fahrenheit') {
  const tempInCelsius = unit === 'fahrenheit' ? (temperature - 32) * 5/9 : temperature;
  
  const conditions = [
    { condition: 'sunny', description: 'Clear sky with bright sunshine', tempRange: [15, 40] },
    { condition: 'partly_cloudy', description: 'Partly cloudy with some sun', tempRange: [10, 35] },
    { condition: 'cloudy', description: 'Overcast with thick clouds', tempRange: [5, 30] },
    { condition: 'rainy', description: 'Light to moderate rainfall', tempRange: [5, 25] },
    { condition: 'stormy', description: 'Thunderstorms with heavy rain', tempRange: [15, 30] },
    { condition: 'snowy', description: 'Snow falling', tempRange: [-10, 5] },
    { condition: 'foggy', description: 'Dense fog reducing visibility', tempRange: [0, 20] },
    { condition: 'windy', description: 'Strong winds', tempRange: [5, 25] }
  ];

  // 过滤适合当前温度的天气条件
  const suitableConditions = conditions.filter(c => 
    tempInCelsius >= c.tempRange[0] && tempInCelsius <= c.tempRange[1]
  );

  // 如果没有合适的条件，返回默认值
  if (suitableConditions.length === 0) {
    return { condition: 'partly_cloudy', description: 'Partly cloudy' };
  }

  // 随机选择一个合适的天气条件
  const randomIndex = Math.floor(Math.random() * suitableConditions.length);
  return suitableConditions[randomIndex];
}