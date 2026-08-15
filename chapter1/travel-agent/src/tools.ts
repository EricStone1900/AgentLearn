export async function getWeather(city: string): Promise<string> {
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "travel-agent-demo",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return `错误：天气接口返回 HTTP ${response.status}`;
    }

    const data = (await response.json()) as {
      current_condition?: Array<{
        weatherDesc?: Array<{ value?: string }>;
        temp_C?: string;
        FeelsLikeC?: string;
        humidity?: string;
      }>;
    };

    const current = data.current_condition?.[0];

    if (!current) {
      return `错误：没有查询到 ${city} 的天气数据`;
    }

    const description = current.weatherDesc?.[0]?.value ?? "未知天气";

    const temperature = current.temp_C ?? "未知";
    const feelsLike = current.FeelsLikeC ?? "未知";
    const humidity = current.humidity ?? "未知";

    return [
      `${city}当前天气：${description}`,
      `气温：${temperature}℃`,
      `体感温度：${feelsLike}℃`,
      `湿度：${humidity}%`,
    ].join("，");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return `错误：查询天气失败，${message}`;
  }
}

type TavilySearchResponse = {
  answer?: string;
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
  }>;
};

export async function getAttraction(
  city: string,
  weather: string,
): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    return "错误：没有配置 TAVILY_API_KEY";
  }

  const query =
    `${city}在“${weather}”天气条件下，适合游览的旅游景点推荐。` +
    `请说明推荐理由，并优先考虑天气适宜性。`;

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        include_answer: true,
        max_results: 3,
      }),
    });

    if (!response.ok) {
      const body = await response.text();

      return `错误：景点搜索接口返回 HTTP ${response.status}，${body}`;
    }

    const data = (await response.json()) as TavilySearchResponse;

    if (data.answer) {
      return data.answer;
    }

    const results = data.results ?? [];

    if (results.length === 0) {
      return `没有搜索到适合 ${city} 当前天气的景点`;
    }

    return results
      .map((result, index) => {
        const title = result.title ?? "未知景点";
        const content = result.content ?? "暂无介绍";
        const url = result.url ?? "无链接";

        return `${index + 1}. ${title}\n${content}\n来源：${url}`;
      })
      .join("\n\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return `错误：搜索景点失败，${message}`;
  }
}
